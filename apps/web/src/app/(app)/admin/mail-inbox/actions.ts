'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  events,
  mailAttachments,
  mailMessages,
  mailWorkerJobs,
  resultDrafts,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { findOrCreateEdition, findOrCreateSeries } from '@/lib/edition/resolve'
import {
  eventFormSchema,
  extractEventFormData,
  extractEventUnitsFormData,
} from '@/lib/form-schemas'
import { broadcastMailToEvent, loadActiveBinding } from '@/lib/line-broadcast'
import { LEAD_TEXT_MAX_LENGTH } from '@/lib/broadcast-lead-presets'
import {
  linkableEventCutoffStr,
  validateLinkableEvent,
} from './linkable-events'
import {
  classifyMail,
  persistOutcome,
} from '@kagetra/mail-worker/classify/classifier'
import { AnthropicSonnet46Extractor } from '@kagetra/mail-worker/classify/llm/anthropic'
import { loadLlmConfig } from '@kagetra/mail-worker/config'

// Set of statuses still subject to operator action. `approved`, `rejected`,
// and `superseded` are terminal: any further mutation would corrupt review
// history (e.g. linking a rejected draft to an event flips it back to
// approved, re-extracting a superseded draft revives it via persistOutcome).
const APPROVABLE_STATUSES = ['pending_review', 'ai_failed'] as const

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

export async function approveDraft(draftId: number, formData: FormData) {
  const session = await requireAdminSession()

  const parsed = eventFormSchema.parse(extractEventFormData(formData))

  // EventForm renders eligible grades as separate `grade_X` checkboxes which
  // extractEventFormData / eventFormSchema do not cover; collect them here
  // exactly like events/new and events/[id]/edit do.
  const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(
    (g) => formData.get(`grade_${g}`) === 'on',
  )

  // Capture the post-commit state for the LINE broadcast trigger so we can
  // schedule it AFTER the response is flushed — without round-tripping a
  // second query.
  let approvedEventId: number | null = null
  let approvedMailMessageId: number | null = null
  let approvedIsCorrection = false

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(events)
      .values({
        ...parsed,
        eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
        createdBy: session.user.id,
      })
      .returning({ id: events.id })
    const newEventId = inserted[0]?.id
    if (newEventId == null) throw new Error('event insert failed')

    // Status-gated update inside the transaction. Two concurrent approveDraft
    // calls would both insert events, but only one will see a row to update
    // here (the loser blocks on the row lock and then sees status='approved');
    // the loser throws and the speculative event insert rolls back with the
    // transaction. Same guard catches direct API calls against finalized
    // drafts.
    const updated = await tx
      .update(tournamentDrafts)
      .set({
        status: 'approved',
        eventId: newEventId,
        approvedByUserId: session.user.id,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tournamentDrafts.id, draftId),
          inArray(tournamentDrafts.status, APPROVABLE_STATUSES),
        ),
      )
      .returning({
        id: tournamentDrafts.id,
        messageId: tournamentDrafts.messageId,
        isCorrection: tournamentDrafts.isCorrection,
      })

    if (updated.length === 0) {
      throw new Error('draft is not approvable')
    }

    approvedEventId = newEventId
    approvedMailMessageId = updated[0]!.messageId
    approvedIsCorrection = updated[0]!.isCorrection

    // Sync mail_messages.status when the draft is finalized so the inbox
    // list filter and the mail-worker re-extract path can rely on a single
    // source of truth for "operator-closed". Without this, drafts approved
    // from an `ai_failed` mail leave the mail row stuck in `ai_failed` and
    // the reextract CLI would (incorrectly) retarget it — see worklog
    // 2026-05-12 session 3 (mail_id=12 orphan).
    await tx
      .update(mailMessages)
      .set({
        status: 'archived',
        // mail-triage-badge: ドラフト処理（承認/却下/紐付け）も「処理済み」の
        // 一形態。未処理バッジから外すため triage_status も同時に閉じる。
        triageStatus: 'processed',
        triagedAt: sql`now()`,
        triagedByUserId: session.user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, updated[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath('/events')

  // event-line-broadcast: trigger after the response is flushed so the
  // operator's UI returns immediately — pdftoppm / libreoffice can take
  // tens of seconds on a beefy mail and would otherwise block the redirect.
  // `broadcastMailToEvent` is best-effort: failures are recorded into
  // event_broadcast_messages without affecting the approval.
  if (approvedEventId != null && approvedMailMessageId != null) {
    const eventId = approvedEventId
    const mailMessageId = approvedMailMessageId
    const isCorrection = approvedIsCorrection
    after(async () => {
      try {
        await broadcastMailToEvent(db, { eventId, mailMessageId, isCorrection })
      } catch (err) {
        console.error('[approveDraft] broadcastMailToEvent failed', err)
      }
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// tournament-title-grade-split: 1 ドラフト : N イベントの複数単位承認。
//
// approveDraft は「1 draft = 1 event」の旧経路 (後方互換のため残置)。
// approveDraftUnits は payload.events[] の各単位を個別フォームで受け取り、
// チェックされた未登録単位を 1 tx で events に INSERT する。全単位が
// materialize 済みになって初めて draft=approved + mail processed に倒す
// (部分承認中は pending_review 維持 = メールも未処理のまま受信箱に残す)。
// ─────────────────────────────────────────────────────────────────────────

/**
 * Collect the `unit_key` set present in a draft's extracted_payload.
 *
 * New format (2.0.0): `payload.events[]` → each `unit_key`. Old format
 * (single `extracted` object) normalizes to a single synthetic unit `['u1']`,
 * matching ApprovalForm's normalization so an old-format draft is considered
 * "fully materialized" once that one synthetic unit has an event row.
 */
function extractPayloadUnitKeys(payload: unknown): string[] {
  if (payload && typeof payload === 'object') {
    const p = payload as {
      events?: unknown
      extracted?: unknown
    }
    if (Array.isArray(p.events) && p.events.length > 0) {
      return p.events
        .map((e) =>
          e && typeof e === 'object'
            ? (e as { unit_key?: unknown }).unit_key
            : undefined,
        )
        .filter((k): k is string => typeof k === 'string')
    }
  }
  // SHOULD_FIX-1: null / 空 events / 旧 `extracted` のいずれも、ApprovalForm の
  // normalizeUnits は synthetic 'u1' を 1 件描画する。ここも 'u1' を返して突合
  // させないと、手動で 1 件作成しても allMaterialized が常に false となり、
  // draft/mail が pending に取り残される。
  return ['u1']
}

/**
 * Fire the LINE auto-broadcast for newly-created events, de-duplicated by the
 * bound LINE group (requirements §3.4): when B級 and C級 of the same
 * announcement are both bound to the same 大阪 group, the mail must be pushed
 * exactly once. Best-effort — a failed push is logged and never blocks the
 * approval.
 */
async function broadcastApprovedUnits(
  eventIds: number[],
  mailMessageId: number,
  isCorrection: boolean,
): Promise<void> {
  const sentGroups = new Set<string>()
  for (const eventId of eventIds) {
    try {
      const binding = await loadActiveBinding(db, eventId)
      if (!binding) continue
      if (sentGroups.has(binding.lineGroupId)) continue
      sentGroups.add(binding.lineGroupId)
      await broadcastMailToEvent(db, { eventId, mailMessageId, isCorrection })
    } catch (err) {
      console.error('[approveDraftUnits] broadcastMailToEvent failed', err)
    }
  }
}

export async function approveDraftUnits(draftId: number, formData: FormData) {
  const session = await requireAdminSession()

  const units = extractEventUnitsFormData(formData)
  if (units.length === 0) {
    throw new Error('登録するイベントが選択されていません')
  }

  // r5 blocker: status / payload に依存する判定（approvable・allowedUnitKeys・
  // allMaterialized）はすべて tx 内の FOR UPDATE ロック済み行を使う（下記）。
  // pre-lock read を信用すると、並行 reextractDraft が LLM 実行後に payload
  // （= unit_key 集合）を書き換えたとき、古い unit_key で events を作るレースが残る。
  // ここでは payload に依存しない parse + FK 検証だけを tx 前に済ませる。

  // Parse every selected unit BEFORE opening the transaction so a malformed unit
  // aborts the whole batch without a partial INSERT — same field validation
  // (eventFormSchema) as events/new / approveDraft, applied per unit.
  const parsedUnits = units.map((unit) => ({
    unitKey: unit.unitKey,
    eligibleGrades: unit.eligibleGrades,
    parsed: eventFormSchema.parse(unit.data),
  }))

  // tournament-entry-rosters flow①: 開催(edition) 紐付け（管理者確認・draft 単位の
  // 直下フィールド）。link が ON のときだけ系列名＋回次から edition を解決/新規作成し、
  // この draft から生成する events 全件に同じ edition_id を張る（events:edition は N:1）。
  // 名寄せは管理者が確認した name で行う（findOrCreateSeries は正規化完全一致なら既存、
  // 無ければ新規作成）。link OFF なら edition_id は null のまま（非破壊）。
  const editionLink = formData.get('editionLink') === 'on'
  // Codex R3: 新規系列の作成は管理者が「新規系列として作成」を明示チェックしたときだけ許可する
  // （未一致名の silent な master 化を防ぐ）。findOrCreateSeries は allowCreate=false で未一致 throw。
  const editionCreateNewSeries = formData.get('editionCreateNewSeries') === 'on'
  const editionSeriesNameRaw = formData.get('editionSeriesName')
  const editionSeriesName =
    typeof editionSeriesNameRaw === 'string' ? editionSeriesNameRaw.trim() : ''
  const editionNumberRaw = formData.get('editionNumber')
  const editionNumber =
    editionLink && typeof editionNumberRaw === 'string' && editionNumberRaw !== ''
      ? Number(editionNumberRaw)
      : null
  if (editionLink) {
    if (!editionSeriesName) {
      throw new Error('入力が不正です: 開催を紐付けるには系列名が必要です')
    }
    if (editionNumber == null || !Number.isInteger(editionNumber) || editionNumber <= 0) {
      throw new Error('入力が不正です: 回次は正の整数で指定してください')
    }
  }
  // edition.year は最初の有効な event_date の年から導出（同年2回・中止スキップがあるため
  // 年→回次の自動関数は使わない＝要件 §3.1。year は表示用メタ）。
  const editionYear = (() => {
    for (const u of parsedUnits) {
      const d = u.parsed.eventDate
      if (typeof d === 'string' && /^\d{4}-/.test(d)) return Number(d.slice(0, 4))
    }
    return null
  })()

  const createdEventIds: number[] = []
  let approvedMailMessageId: number | null = null
  let approvedIsCorrection = false
  let didFinalize = false
  // r5 blocker: 部分承認時の broadcast に使う messageId / isCorrection も
  // ロック済み行から採取する（pre-lock read を使うと、並行 reextract 後の古い
  // isCorrection を配信に使う恐れがある）。
  let lockedMessageId: number | null = null
  let lockedIsCorrection = false

  await db.transaction(async (tx) => {
    // r4 blocker: 並行する reject / linkDraftToEvent / completeDraft が draft を
    // terminal 状態へ更新した後でも、このトランザクションが events を INSERT でき
    // ると「作成済みイベントのある rejected / linked draft」という矛盾が生じる。
    // tx の最初に draft 行を FOR UPDATE でロックして APPROVABLE_STATUSES を再確認
    // する。全ての mutating action（approve/reject/link/complete）が同じ draft 行を
    // 最初にロックするので、相互の race が直列化されて閉じる。
    //
    // r5 blocker: status だけでなく messageId / isCorrection / extractedPayload も
    // ロック済み行から取得する。allowedUnitKeys（未知単位の拒否）と allMaterialized
    // （完了判定）の突合は、この FOR UPDATE 配下の payload だけで行う。こうすると
    // 並行 reextractDraft（同じく draft 行を先頭で FOR UPDATE する）と直列化され、
    // 「古い payload の unit_key で events を作る」「作成済み event のある draft の
    // payload が後から書き換わる」という 1:N 突合崩れのレースが閉じる。
    const locked = await tx
      .select({
        status: tournamentDrafts.status,
        messageId: tournamentDrafts.messageId,
        isCorrection: tournamentDrafts.isCorrection,
        extractedPayload: tournamentDrafts.extractedPayload,
      })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.id, draftId))
      .for('update')
    if (locked.length === 0) throw new Error('draft not found')
    const lockedRow = locked[0]!
    if (
      !APPROVABLE_STATUSES.includes(
        lockedRow.status as (typeof APPROVABLE_STATUSES)[number],
      )
    ) {
      throw new Error('draft is not approvable')
    }
    lockedMessageId = lockedRow.messageId
    lockedIsCorrection = lockedRow.isCorrection

    // payload の unit_key 集合はロック済み行から一度だけ計算し、allowedUnitKeys
    // と allMaterialized の両方で使う（同じ payload を参照することで突合が崩れない）。
    const payloadUnitKeys = extractPayloadUnitKeys(lockedRow.extractedPayload)
    const allowedUnitKeys = new Set(payloadUnitKeys)
    // r3 should_fix: only accept unit_keys that actually belong to this draft's
    // payload. A tampered / stale client form could otherwise POST an arbitrary
    // unit_key and create an `events` row whose tournament_draft_unit_key has no
    // counterpart in the draft — polluting the materialize/complete reconciliation.
    // extractPayloadUnitKeys mirrors ApprovalForm.normalizeUnits (legacy/null → 'u1').
    for (const { unitKey } of parsedUnits) {
      if (!allowedUnitKeys.has(unitKey)) {
        throw new Error(`入力が不正です: 未知のイベント単位 (${unitKey})`)
      }
    }

    // flow①: 開催(edition) を draft 単位で 1 回だけ解決/新規作成する（FOR UPDATE 直列化＋
    // UNIQUE(series_id, edition_number) onConflict は findOrCreateEdition 内）。link OFF は null。
    // 部分承認の 2 回目以降も findOrCreate は冪等なので同じ edition_id に収束する。
    let resolvedEditionId: number | null = null
    if (editionLink && editionNumber != null) {
      // Codex R4 should_fix: 新規 series 作成時の kind は selected unit の kind から決める
      // （series.kind は系列単位の事実。既定 individual のままだと団体戦系列が誤って個人戦化）。
      // 1 案内 = 1 大会 = 1 kind 前提。個人/団体が混在する案内は系列 kind を確定できないので弾く。
      const editionKinds = new Set(parsedUnits.map((u) => u.parsed.kind))
      if (editionKinds.size > 1) {
        throw new Error(
          '入力が不正です: 個人戦/団体戦が混在する案内は 1 つの開催にまとめて紐付けられません',
        )
      }
      const editionKind = parsedUnits[0]?.parsed.kind ?? 'individual'
      // allowCreate は管理者が「新規系列として作成」を明示したときだけ true。未一致かつ未明示は
      // findOrCreateSeries が throw（silent な新規 master 化を防ぐ）。複数一致も throw（曖昧）。
      const { seriesId } = await findOrCreateSeries(tx, {
        name: editionSeriesName,
        allowCreate: editionCreateNewSeries,
        kind: editionKind,
      })
      const { editionId } = await findOrCreateEdition(tx, {
        seriesId,
        editionNumber,
        year: editionYear,
        // 案内由来＝開催前。結果未確定なので unconfirmed。flow②（結果取込）で held に確定。
        status: 'unconfirmed',
        rawName: editionSeriesName,
      })
      resolvedEditionId = editionId
    }

    for (const { unitKey, eligibleGrades, parsed } of parsedUnits) {
      // Idempotency: a unit already materialized for this draft (e.g. a
      // double-submit, or the operator re-opening the page and re-registering
      // an already-created unit) must not insert a second event row.
      const existing = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.tournamentDraftId, draftId),
            eq(events.tournamentDraftUnitKey, unitKey),
          ),
        )
        .limit(1)
      if (existing.length > 0) continue

      // CRITICAL-4: the SELECT above is best-effort de-dup, but a concurrent
      // approval / double-submit can slip a second INSERT past it. The DB-side
      // partial unique index (events_tournament_draft_unit_key_uniq) is the
      // hard guarantee; onConflictDoNothing makes the race lose silently. On a
      // conflict `returning` is empty → this unit was already materialized by
      // the other writer, so skip it (do NOT count it as newly created).
      const inserted = await tx
        .insert(events)
        .values({
          ...parsed,
          eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
          createdBy: session.user.id,
          tournamentDraftId: draftId,
          tournamentDraftUnitKey: unitKey,
          // flow①: 解決した開催。link OFF/未解決なら null。
          editionId: resolvedEditionId,
        })
        // `where` is REQUIRED here: the unique index is PARTIAL (WHERE both
        // columns NOT NULL), and Postgres only treats a partial index as the
        // conflict arbiter when ON CONFLICT repeats its predicate — otherwise
        // it raises "no unique or exclusion constraint matching the ON CONFLICT
        // specification". Mirror events_tournament_draft_unit_key_uniq. (drizzle
        // 0.45 exposes this arbiter predicate as `where`, not `targetWhere`.)
        .onConflictDoNothing({
          target: [events.tournamentDraftId, events.tournamentDraftUnitKey],
          where: sql`${events.tournamentDraftId} IS NOT NULL AND ${events.tournamentDraftUnitKey} IS NOT NULL`,
        })
        .returning({ id: events.id })
      const newEventId = inserted[0]?.id
      // Empty returning here means the unique index rejected the row (a
      // concurrent insert won the race). Not an error — just skip.
      if (newEventId == null) continue
      createdEventIds.push(newEventId)
    }

    // flow① blocker fix (Codex R1): edition は draft 単位（events:edition は N:1）。今回 INSERT
    // した events だけでなく「過去の部分承認で既に materialize 済みの events」も同じ edition_id へ
    // 収束させる。でないと editionLink を後から ON にしたとき、同一 draft 由来の events で edition_id
    // が混在する／全 unit 既存だと series/edition だけ作られてどの event にも紐付かない。link ON の
    // ときだけ実行する（OFF のときは既存 edition_id を勝手に剥がさない）。
    if (resolvedEditionId != null) {
      await tx
        .update(events)
        .set({ editionId: resolvedEditionId, updatedAt: sql`now()` })
        .where(
          and(
            eq(events.tournamentDraftId, draftId),
            sql`${events.editionId} IS DISTINCT FROM ${resolvedEditionId}`,
          ),
        )
    }

    // Decide whether the draft is now fully materialized: every unit_key in the
    // payload must have a corresponding events row (tournament_draft_id =
    // draftId). `payloadUnitKeys` was computed above from the FOR UPDATE locked
    // row, so it is consistent with the allowedUnitKeys gate and immune to a
    // concurrent reextract. Read the materialized set inside the tx so the units
    // we just inserted are counted.
    const materializedRows = await tx
      .select({ unitKey: events.tournamentDraftUnitKey })
      .from(events)
      .where(eq(events.tournamentDraftId, draftId))
    const materialized = new Set(
      materializedRows
        .map((r) => r.unitKey)
        .filter((k): k is string => typeof k === 'string'),
    )
    const allMaterialized =
      payloadUnitKeys.length > 0 &&
      payloadUnitKeys.every((k) => materialized.has(k))

    if (allMaterialized) {
      // Status-gated finalize, mirroring approveDraft. event_id stays null —
      // for split approvals events.tournament_draft_id is the source of truth
      // (tournament_drafts.event_id is reserved for linkDraftToEvent).
      const updated = await tx
        .update(tournamentDrafts)
        .set({
          status: 'approved',
          approvedByUserId: session.user.id,
          approvedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(tournamentDrafts.id, draftId),
            inArray(tournamentDrafts.status, APPROVABLE_STATUSES),
          ),
        )
        .returning({
          id: tournamentDrafts.id,
          messageId: tournamentDrafts.messageId,
          isCorrection: tournamentDrafts.isCorrection,
        })
      if (updated.length === 0) {
        throw new Error('draft is not approvable')
      }

      await tx
        .update(mailMessages)
        .set({
          status: 'archived',
          // mail-triage-badge: 承認完了は「処理済み」。未処理バッジから外す。
          triageStatus: 'processed',
          triagedAt: sql`now()`,
          triagedByUserId: session.user.id,
          updatedAt: sql`now()`,
        })
        .where(eq(mailMessages.id, updated[0]!.messageId))

      approvedMailMessageId = updated[0]!.messageId
      approvedIsCorrection = updated[0]!.isCorrection
      didFinalize = true
    }
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath('/events')

  // event-line-broadcast: 承認で作成したイベントの分だけ、応答 flush 後に
  // 配信を起こす。グループ重複は broadcastApprovedUnits 内で排除する。
  // mailMessageId は finalize した場合のみ updated から取れるが、部分承認でも
  // 配信はしたいので lockedMessageId を使う (常に同一メールを指す)。
  // createdEventIds.length > 0 は tx が lock を取って commit した証なので
  // lockedMessageId は必ず非 null（型のため明示ガード）。
  if (createdEventIds.length > 0 && lockedMessageId != null) {
    const eventIds = createdEventIds
    const mailMessageId = approvedMailMessageId ?? lockedMessageId
    const isCorrection = didFinalize ? approvedIsCorrection : lockedIsCorrection
    after(async () => {
      await broadcastApprovedUnits(eventIds, mailMessageId, isCorrection)
    })
  }
}

/**
 * Close a draft without creating the remaining (unregistered) units —
 * requirements シナリオ C「残りは作らず完了」. Flips the draft to approved and
 * the mail to archived/processed, leaving any already-materialized events in
 * place. No broadcast (nothing new is created).
 */
export async function completeDraft(draftId: number) {
  const session = await requireAdminSession()

  await db.transaction(async (tx) => {
    // r4 blocker: draft 行を FOR UPDATE でロックして approve/reject/link と直列化。
    const locked = await tx
      .select({
        status: tournamentDrafts.status,
        messageId: tournamentDrafts.messageId,
      })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.id, draftId))
      .for('update')
    if (locked.length === 0) throw new Error('draft not found')
    if (
      !APPROVABLE_STATUSES.includes(
        locked[0]!.status as (typeof APPROVABLE_STATUSES)[number],
      )
    ) {
      throw new Error('draft is not approvable')
    }

    // r3 blocker: 1 件も materialize していない draft を完了にすると 0 イベントで
    // processed になり大会案内を取りこぼす。ロック内で確認するので並行 approve の
    // INSERT とも整合する（0 件で閉じたいケースは reject に誘導、UI もボタン非表示）。
    const materialized = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.tournamentDraftId, draftId))
      .limit(1)
    if (materialized.length === 0) {
      throw new Error(
        '作成済みイベントがありません。先にイベントを登録するか、却下してください',
      )
    }

    await tx
      .update(tournamentDrafts)
      .set({
        status: 'approved',
        approvedByUserId: session.user.id,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(tournamentDrafts.id, draftId))

    await tx
      .update(mailMessages)
      .set({
        status: 'archived',
        triageStatus: 'processed',
        triagedAt: sql`now()`,
        triagedByUserId: session.user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, locked[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function rejectDraft(draftId: number, formData: FormData) {
  const session = await requireAdminSession()

  const reasonRaw = formData.get('rejection_reason')
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : ''
  if (!reason) throw new Error('却下理由は必須です')

  await db.transaction(async (tx) => {
    // r4 blocker: draft 行を FOR UPDATE でロックして approve/complete/link と
    // 直列化し、materialized 確認と terminal 更新を同一 tx に入れる。これで
    // 「作成済みイベントのある draft の却下」(CRITICAL-3) が race-free になる。
    const locked = await tx
      .select({
        status: tournamentDrafts.status,
        messageId: tournamentDrafts.messageId,
      })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.id, draftId))
      .for('update')
    if (locked.length === 0) throw new Error('draft not found')
    if (
      !APPROVABLE_STATUSES.includes(
        locked[0]!.status as (typeof APPROVABLE_STATUSES)[number],
      )
    ) {
      throw new Error('draft is not rejectable')
    }
    // CRITICAL-3: 作成済みイベントを残したまま rejected にすると矛盾。ロック内で
    // 確認するので並行 approve の INSERT とも整合する。
    const materialized = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.tournamentDraftId, draftId))
      .limit(1)
    if (materialized.length > 0) {
      throw new Error('作成済みイベントがあるため却下できません')
    }

    // event_id is intentionally not touched here: rejection doesn't link to an
    // event, and a previously linked draft being re-rejected keeps its history.
    await tx
      .update(tournamentDrafts)
      .set({
        status: 'rejected',
        rejectedByUserId: session.user.id,
        rejectedAt: sql`now()`,
        rejectionReason: reason,
        updatedAt: sql`now()`,
      })
      .where(eq(tournamentDrafts.id, draftId))

    // Sync mail_messages.status — see approveDraft for rationale.
    await tx
      .update(mailMessages)
      .set({
        status: 'archived',
        // mail-triage-badge: ドラフト処理（承認/却下/紐付け）も「処理済み」の
        // 一形態。未処理バッジから外すため triage_status も同時に閉じる。
        triageStatus: 'processed',
        triagedAt: sql`now()`,
        triagedByUserId: session.user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, locked[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function reextractDraft(draftId: number) {
  await requireAdminSession()

  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    columns: { messageId: true, status: true },
  })
  if (!draft) throw new Error('draft not found')
  // persistOutcome (called below) rewrites status / extracted_payload via
  // UPSERT on message_id, so re-extracting a finalized draft would silently
  // resurrect it for review. Guard at this action layer; the cron-driven
  // worker path doesn't touch already-classified mails.
  if (
    draft.status !== 'pending_review' &&
    draft.status !== 'ai_failed'
  ) {
    throw new Error('draft is not reextractable')
  }

  // tournament-title-grade-split: re-extraction rewrites the payload (and its
  // unit_key set), so any unit already materialized as an `events` row would
  // be orphaned / mismatched. Refuse once a single event references this draft
  // (requirements §3.4 再 AI 抽出のガード). This pre-LLM check is a fail-fast so
  // we don't burn an Anthropic call on an already-materialized draft; the
  // authoritative, race-free re-check happens under FOR UPDATE below.
  const materialized = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.tournamentDraftId, draftId))
    .limit(1)
  if (materialized.length > 0) {
    throw new Error('既にイベントが作成済みのため再抽出できません')
  }

  const cfg = loadLlmConfig()
  const llm = new AnthropicSonnet46Extractor({ apiKey: cfg.anthropicApiKey })
  const outcome = await classifyMail(db, draft.messageId, llm, { force: true })

  // r5 blocker: classifyMail の LLM ラウンドトリップはロックなしで走るため、その間に
  // 並行 approveDraftUnits が events を materialize（場合により draft を finalize）し得る。
  // persistOutcome は message_id 上の UPSERT で extracted_payload（= unit_key 集合）を
  // 書き換えるので、events 作成後にそれをやると作成済み event の
  // tournament_draft_unit_key が payload と突き合わなくなる。draft 行を FOR UPDATE で
  // 取り直し、まだ再抽出可能 かつ materialized event がゼロ であることを再確認したうえで、
  // 同じロック下で payload を更新する。これで approveDraftUnits 側（同じく draft 行を
  // 先頭で FOR UPDATE する）と相互に直列化される。
  await db.transaction(async (tx) => {
    const locked = await tx
      .select({ status: tournamentDrafts.status })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.id, draftId))
      .for('update')
    if (locked.length === 0) throw new Error('draft not found')
    if (
      locked[0]!.status !== 'pending_review' &&
      locked[0]!.status !== 'ai_failed'
    ) {
      throw new Error('draft is not reextractable')
    }
    const materializedLocked = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.tournamentDraftId, draftId))
      .limit(1)
    if (materializedLocked.length > 0) {
      throw new Error('既にイベントが作成済みのため再抽出できません')
    }
    await persistOutcome(tx, draft.messageId, outcome)
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function linkDraftToEvent(draftId: number, eventId: number) {
  const session = await requireAdminSession()

  const target = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true },
  })
  if (!target) throw new Error('Event not found')

  // r3 review blocker: 既存大会への紐付け経路でも broadcast を起動しないと、
  // 追加メール / 訂正版が自動配信されない (approveDraft の連動だけでは、
  // 新規大会の初回のみ配信されてしまう)。transaction commit 後の after()
  // で発火させるため、必要な情報を取り出して保持する。
  let linkedMailMessageId: number | null = null
  let linkedIsCorrection = false

  await db.transaction(async (tx) => {
    // r4 blocker: FOR UPDATE で approve/reject/complete と直列化。
    const locked = await tx
      .select({ status: tournamentDrafts.status })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.id, draftId))
      .for('update')
    if (locked.length === 0) throw new Error('draft not found')
    if (
      !APPROVABLE_STATUSES.includes(
        locked[0]!.status as (typeof APPROVABLE_STATUSES)[number],
      )
    ) {
      throw new Error('draft is not linkable')
    }
    // CRITICAL-3 二重防御: 分割で自前イベントを作成済みの draft を単一の既存
    // イベントへ紐付けると矛盾（作成済みイベントが孤児化する）。ロック内で確認する
    // ので並行 approve の INSERT とも整合する。UI も materialize 後は link を隠す。
    const materialized = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.tournamentDraftId, draftId))
      .limit(1)
    if (materialized.length > 0) {
      throw new Error('作成済みイベントがあるため紐付けできません')
    }

    const updated = await tx
      .update(tournamentDrafts)
      .set({
        status: 'approved',
        eventId,
        approvedByUserId: session.user.id,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(tournamentDrafts.id, draftId))
      .returning({
        id: tournamentDrafts.id,
        messageId: tournamentDrafts.messageId,
        isCorrection: tournamentDrafts.isCorrection,
      })

    if (updated.length === 0) {
      throw new Error('draft is not linkable')
    }

    linkedMailMessageId = updated[0]!.messageId
    linkedIsCorrection = updated[0]!.isCorrection

    // Sync mail_messages.status — see approveDraft for rationale.
    await tx
      .update(mailMessages)
      .set({
        status: 'archived',
        // mail-triage-badge: ドラフト処理（承認/却下/紐付け）も「処理済み」の
        // 一形態。未処理バッジから外すため triage_status も同時に閉じる。
        triageStatus: 'processed',
        triagedAt: sql`now()`,
        triagedByUserId: session.user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, updated[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath(`/events/${eventId}`)

  // event-line-broadcast: 既存大会が既に LINE グループに紐付け済み (status=
  // 'linked') なら、自動配信が走る。未紐付けの大会なら broadcastMailToEvent
  // 内で skipped を返すだけ。承認操作には影響させない (best-effort)。
  if (linkedMailMessageId != null) {
    const mailMessageId = linkedMailMessageId
    const isCorrection = linkedIsCorrection
    after(async () => {
      try {
        await broadcastMailToEvent(db, { eventId, mailMessageId, isCorrection })
      } catch (err) {
        console.error('[linkDraftToEvent] broadcastMailToEvent failed', err)
      }
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// mail-triage-badge: 全メールの手動トリアージ。
//
// ドラフトの有無に関わらず任意の mail_messages 行を processed / unprocessed に
// 遷移させる。未処理バッジ件数は `triage_status != 'processed'`（= unprocessed）
// で数える。
//
// mail-inbox-mailer (2026-06-07): 「保留 (deferred)」状態は廃止し 2 状態化。
// 処理せず放置することが暗黙の保留である、というモデルに統合した。`deferMail`
// は削除済み。3 アクション（AI 抽出 / 既存イベント結びつけ / 対応不要）の
// 実体は後続タスク（タスク3 で triggerExtractDraft / linkMailToEvent 等を追加）。
//
// approve/reject/link は status='archived' も伴う「ドラフト処理」だが、以下は
// triage_status だけを動かす軽量操作で status(AI/技術状態)は保持する。
// undoTriage はどの processed でも素直に unprocessed へ戻す（承認済みメールを
// 戻すかは呼び出し側 UI が出すアクションで制御する想定）。
// ─────────────────────────────────────────────────────────────────────────

async function setTriage(
  mailId: number,
  triageStatus: 'processed' | 'unprocessed',
  triagedByUserId: string | null,
) {
  const updated = await db
    .update(mailMessages)
    .set({
      triageStatus,
      // 未処理に戻すときは処理者・処理時刻もクリアして履歴の意味を保つ。
      triagedAt: triageStatus === 'unprocessed' ? null : sql`now()`,
      triagedByUserId,
      updatedAt: sql`now()`,
    })
    .where(eq(mailMessages.id, mailId))
    .returning({ id: mailMessages.id })
  if (updated.length === 0) throw new Error('mail not found')
  revalidatePath('/admin/mail-inbox')
  // mail-triage-badge: 詳細ページ (mail/[id]) にも同じ TriageActions があるので、
  // 詳細パスも再検証して処理後に Server Component の triageStatus を最新化する。
  revalidatePath(`/admin/mail-inbox/mail/${mailId}`)
}

/**
 * 対応不要として片付ける（→ processed、未処理バッジから除外）。
 *
 * Codex r4 blocker: 未完了 draft (ai_processing / pending_review / ai_failed)
 * があるメールを processed にすると、AI 抽出中またはレビュー待ちの draft が
 * 未処理キューから消えて見落とされる。transaction 化して FOR UPDATE で
 * 拒否する。draft が無いか、terminal status (approved / rejected / superseded)
 * のメールのみ「対応不要」可能。
 */
export async function dismissMail(mailId: number) {
  const session = await requireAdminSession()

  await db.transaction(async (tx) => {
    const mailRows = await tx
      .select({
        id: mailMessages.id,
        triageStatus: mailMessages.triageStatus,
      })
      .from(mailMessages)
      .where(eq(mailMessages.id, mailId))
      .for('update')
    if (mailRows.length === 0) throw new Error('mail not found')

    const draftRows = await tx
      .select({ status: tournamentDrafts.status })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.messageId, mailId))
      .for('update')
    if (draftRows.length > 0) {
      const ds = draftRows[0]!.status
      if (ds === 'ai_processing' || ds === 'pending_review' || ds === 'ai_failed') {
        throw new Error('未完了の AI 抽出 draft があるため対応不要にできません')
      }
    }

    await tx
      .update(mailMessages)
      .set({
        triageStatus: 'processed',
        triagedAt: sql`now()`,
        triagedByUserId: session.user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, mailId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/mail/${mailId}`)
}

/** 処理取り消し（→ unprocessed、処理者をクリア）。 */
export async function undoTriage(mailId: number) {
  await requireAdminSession()
  await setTriage(mailId, 'unprocessed', null)
}

// ─────────────────────────────────────────────────────────────────────────
// mail-inbox-mailer タスク3: 3 アクション Server Actions
//
// (a) triggerExtractDraft  — 「会で流す（AI 抽出）」: draft 行 INSERT (ai_processing)
//                            + manual_extract ジョブ enqueue。30 秒 timer が拾う。
// (b) linkMailToEvent      — 「既存イベントに紐付ける」: linked_event_id 更新 +
//                            triage processed + broadcastMailToEvent (after)。
// (c) unlinkMailFromEvent  — 処理済画面 undo の補助: linked_event_id を NULL に
//                            戻す。LINE 配信済メッセージの取り消しは不可。
// ─────────────────────────────────────────────────────────────────────────

/**
 * 「会で流す（AI 抽出）」ボタンの本体。
 *
 * tournament_drafts.message_id は UNIQUE なので、既存 draft の有無で分岐する:
 *   - draft 無し                  → INSERT (status='ai_processing')
 *   - draft.status='ai_failed'    → UPDATE で status='ai_processing' に戻し
 *                                   prompt_version / ai_model / payload をクリア
 *   - draft.status='ai_processing' → エラー「既に AI 抽出中」(Codex r2
 *                                   should-fix: 二重クリック / 複数タブで重複
 *                                   ジョブが入るのを防ぐ。極めて稀な「ジョブが
 *                                   落ちた」復旧経路は stale-claim recovery
 *                                   (jobs.ts) と manual_extract の終端強制で
 *                                   別途カバー)
 *   - その他 (pending_review/approved/rejected/superseded) → エラー
 *
 * UNIQUE 制約と draft の status 更新を **同一トランザクション** で行うので、
 * 並行押下も SELECT FOR UPDATE で直列化される。クライアントは確認ダイアログ＋
 * ボタン disable で二重起動を抑止する（要件 §3.2.5）。
 */
export async function triggerExtractDraft(
  mailId: number,
): Promise<
  | { ok: true; draftId: number; jobId: number }
  | { ok: false; error: string }
> {
  const session = await requireAdminSession()

  try {
    const result = await db.transaction(async (tx) => {
      // Codex r3 blocker: 詳細画面は「unprocessed + draft なし」のときだけ
      // AI 抽出ボタンを出すが、複数タブ / 別管理者操作で stale 状態のまま
      // ボタンが効くと、processed/linked 済 mail にもジョブを積めてしまう。
      // mail を FOR UPDATE で取り、triage と linked_event_id を tx 内で
      // verify する。
      const mailRows = await tx
        .select({
          id: mailMessages.id,
          triageStatus: mailMessages.triageStatus,
          linkedEventId: mailMessages.linkedEventId,
        })
        .from(mailMessages)
        .where(eq(mailMessages.id, mailId))
        .for('update')
      if (mailRows.length === 0) throw new Error('mail not found')
      const mail = mailRows[0]!
      if (mail.triageStatus !== 'unprocessed') {
        throw new Error('既に処理済みのメールです')
      }
      if (mail.linkedEventId !== null) {
        throw new Error('既存イベントに紐付け済みのメールです')
      }

      // FOR UPDATE で並行 trigger と直列化（実害は少ないが UPSERT 競合を避ける）。
      const existing = await tx
        .select({
          id: tournamentDrafts.id,
          status: tournamentDrafts.status,
        })
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, mailId))
        .for('update')

      let draftId: number
      if (existing.length === 0) {
        const inserted = await tx
          .insert(tournamentDrafts)
          .values({
            messageId: mailId,
            status: 'ai_processing',
            extractedPayload: sql`'{}'::jsonb`,
            promptVersion: '',
            aiModel: '',
          })
          .returning({ id: tournamentDrafts.id })
        draftId = inserted[0]!.id
      } else {
        const cur = existing[0]!
        if (cur.status === 'ai_processing') {
          // Codex r2 should-fix: ai_processing 中の再 trigger は重複ジョブを
          // 生むので拒否。クライアント側でも ExtractionInProgressCard が出る
          // 間は AIExtractConfirmDialog ボタンを出さないので、二重押下や複数
          // タブからの直叩きを防ぐサーバー側ガード。
          throw new Error('既に AI 抽出中です')
        }
        if (cur.status !== 'ai_failed') {
          // pending_review / approved / rejected / superseded: 既に状態が確定
          // しているので無条件再抽出は危険。タスク4 で reextract 経路を別 UI に
          // 出す想定。
          throw new Error('既に AI 抽出済みです')
        }
        await tx
          .update(tournamentDrafts)
          .set({
            status: 'ai_processing',
            extractedPayload: sql`'{}'::jsonb`,
            promptVersion: '',
            aiModel: '',
            confidence: null,
            aiRawResponse: null,
            aiTokensInput: null,
            aiTokensOutput: null,
            aiCostUsd: null,
            updatedAt: sql`now()`,
          })
          .where(eq(tournamentDrafts.id, cur.id))
        draftId = cur.id
      }

      const insertedJob = await tx
        .insert(mailWorkerJobs)
        .values({
          requestedByUserId: session.user.id,
          status: 'pending',
          kind: 'manual_extract',
          payload: { mail_message_id: mailId },
        })
        .returning({ id: mailWorkerJobs.id })
      const jobId = insertedJob[0]!.id

      return { draftId, jobId }
    })

    revalidatePath('/admin/mail-inbox')
    revalidatePath(`/admin/mail-inbox/mail/${mailId}`)
    return { ok: true, draftId: result.draftId, jobId: result.jobId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

/**
 * 「組合せ表」「会場案内」「訂正版」などを既存大会に紐付ける。
 *
 * 1 メール = 1 イベントの単純 FK。紐付け確定で:
 *   - mail_messages.linked_event_id = eventId
 *   - triage_status='processed', triaged_at, triaged_by_user_id
 *   - after() で broadcastMailToEvent（既存イベントが LINE グループ linked
 *     済なら LINE 配信、未紐付なら no-op）
 *
 * 紐付け済 mail に対する二重操作は禁止（一度 unlinkMailFromEvent で外してから）。
 * UI 側でもボタンを出さない想定だが、サーバー側でも検証する。
 */
export async function linkMailToEvent(
  mailId: number,
  eventId: number,
  leadText?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminSession()

  // 冒頭メッセージ (任意)。trim 後空なら null、200 字超は紐付け前に弾く
  // (紐付け・配信とも実行しない)。
  const normalizedLeadText = leadText?.trim() || null
  if (normalizedLeadText && normalizedLeadText.length > LEAD_TEXT_MAX_LENGTH) {
    return { ok: false, error: '冒頭メッセージは200文字以内で入力してください' }
  }

  let linkedMailMessageId: number | null = null

  try {
    await db.transaction(async (tx) => {
      // Codex r5 should-fix: UI 側 loadLinkableEvents は status='cancelled' を
      // 除外し、開催日が過去 30 日以内であることを要求する。Server Action 側
      // でも同じ条件を verify しないと、画面表示後に event が cancelled へ
      // 変わった or Server Action を直接叩かれたケースで許容範囲外の event に
      // 紐付けて broadcastMailToEvent まで起動できてしまう。
      const eventRows = await tx
        .select({
          id: events.id,
          status: events.status,
          eventDate: events.eventDate,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1)
      if (eventRows.length === 0) throw new Error('Event not found')
      const eventRow = eventRows[0]!
      const eventInvalid = validateLinkableEvent(
        { status: eventRow.status, eventDate: eventRow.eventDate },
        linkableEventCutoffStr(),
      )
      if (eventInvalid) throw new Error(eventInvalid)

      const mail = await tx
        .select({
          id: mailMessages.id,
          triageStatus: mailMessages.triageStatus,
          linkedEventId: mailMessages.linkedEventId,
        })
        .from(mailMessages)
        .where(eq(mailMessages.id, mailId))
        .for('update')
      if (mail.length === 0) throw new Error('mail not found')
      // Codex r3 blocker: 詳細画面は「unprocessed + draft なし」のときだけ
      // 結びつけボタンを出すが、画面表示後に worker が pending_review を作る
      // 可能性があるので transaction 内で再 verify する。
      if (mail[0]!.triageStatus !== 'unprocessed') {
        throw new Error('既に処理済みのメールです')
      }
      if (mail[0]!.linkedEventId !== null) {
        throw new Error('既に別イベントに紐付け済みです')
      }

      // 未完了 draft (ai_processing / pending_review / ai_failed) があるメール
      // を既存イベントに紐付けると、後で承認操作が走った時に二重配信や状態
      // 矛盾を起こす。AI 抽出フローと既存結びつけは互いに排他にする。
      const conflictingDraft = await tx
        .select({ status: tournamentDrafts.status })
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, mailId))
        .for('update')
      if (
        conflictingDraft.length > 0 &&
        (conflictingDraft[0]!.status === 'ai_processing' ||
          conflictingDraft[0]!.status === 'pending_review' ||
          conflictingDraft[0]!.status === 'ai_failed')
      ) {
        throw new Error('AI 抽出フロー中のメールは結びつけできません')
      }

      await tx
        .update(mailMessages)
        .set({
          linkedEventId: eventId,
          triageStatus: 'processed',
          triagedAt: sql`now()`,
          triagedByUserId: session.user.id,
          updatedAt: sql`now()`,
        })
        .where(eq(mailMessages.id, mailId))

      linkedMailMessageId = mailId
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/mail/${mailId}`)
  revalidatePath(`/events/${eventId}`)

  // 既存 broadcastMailToEvent をそのまま再利用（linkDraftToEvent と同じ流れ）。
  // 「訂正版」フラグは tournament_drafts.is_correction の話で、linked_event_id
  // 経由の補足メールは常に isCorrection=false 扱い（通常の補足配信）。
  if (linkedMailMessageId != null) {
    const messageId = linkedMailMessageId
    after(async () => {
      try {
        await broadcastMailToEvent(db, {
          eventId,
          mailMessageId: messageId,
          isCorrection: false,
          leadText: normalizedLeadText,
        })
      } catch (err) {
        console.error('[linkMailToEvent] broadcastMailToEvent failed', err)
      }
    })
  }

  return { ok: true }
}

/**
 * 既存イベント結びつけの取り消し（処理済画面の undo から呼ばれる）。
 *
 * LINE 配信済メッセージは LINE Messaging API 仕様上取り消せないので、
 * 「紐付けだけ外す」操作（要件 §3.1.8）。triage_status も unprocessed に戻すので、
 * 未処理バッジに再度カウントされる。
 */
export async function unlinkMailFromEvent(mailId: number) {
  await requireAdminSession()

  let previousEventId: number | null = null

  await db.transaction(async (tx) => {
    const mail = await tx
      .select({
        id: mailMessages.id,
        linkedEventId: mailMessages.linkedEventId,
      })
      .from(mailMessages)
      .where(eq(mailMessages.id, mailId))
      .for('update')
    if (mail.length === 0) throw new Error('mail not found')
    previousEventId = mail[0]!.linkedEventId

    await tx
      .update(mailMessages)
      .set({
        linkedEventId: null,
        triageStatus: 'unprocessed',
        triagedAt: null,
        triagedByUserId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, mailId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/mail/${mailId}`)
  if (previousEventId != null) {
    revalidatePath(`/events/${previousEventId}`)
  }
}

// PR5 Phase 4a — manual mail-fetch job queue.
//
// The Server Action is INSERT-only into `mail_worker_jobs`; the systemd-timer
// driven mail-worker dispatcher claims the row via FOR UPDATE SKIP LOCKED on
// its next tick (~30 min). UI feedback is therefore "ジョブ #N を予約しました"
// only — no progress polling in v1 (deferred per pr5-plan.md).
const PRESET_VALUES = ['24h', '3d', '7d', 'custom'] as const
const triggerMailFetchSchema = z
  .object({
    preset: z.enum(PRESET_VALUES),
    // YYYY-MM-DD only when preset='custom'. The regex enforces the shape so
    // computeSince()'s `${customDate}T00:00:00+09:00` template can never
    // produce an Invalid Date silently.
    customDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'customDate は YYYY-MM-DD 形式')
      .optional(),
  })
  .refine(
    (v) => v.preset !== 'custom' || !!v.customDate,
    { message: 'preset=custom のとき customDate が必須', path: ['customDate'] },
  )

/**
 * Compute the `since` timestamp from the form preset.
 *
 *   '24h'    → now - 24 hours
 *   '3d'     → now - 3 days
 *   '7d'     → now - 7 days
 *   'custom' → JST 0:00 of the given YYYY-MM-DD
 *
 * JST round-trip mirrors `apps/mail-worker/src/cli-args.ts`'s `parseSinceArg`
 * — bare `new Date('2026-04-12')` would resolve to UTC midnight (= 09:00 JST)
 * and silently drop mails received between 00:00 and 08:59 JST that day.
 * Mail-worker's exports map does not surface `cli-args`, so we keep the
 * computation duplicated here rather than widening the package surface.
 */
function computeSince(input: { preset: (typeof PRESET_VALUES)[number]; customDate?: string }): Date {
  const now = Date.now()
  switch (input.preset) {
    case '24h':
      return new Date(now - 24 * 3600 * 1000)
    case '3d':
      return new Date(now - 3 * 24 * 3600 * 1000)
    case '7d':
      return new Date(now - 7 * 24 * 3600 * 1000)
    case 'custom': {
      // refine() above guarantees customDate is set when preset='custom',
      // but TypeScript narrowing through the discriminated union on a single
      // optional field needs the explicit guard.
      if (!input.customDate) {
        throw new Error('customDate required for preset=custom')
      }
      const d = new Date(`${input.customDate}T00:00:00+09:00`)
      if (Number.isNaN(d.getTime())) {
        throw new Error(`invalid customDate: ${input.customDate}`)
      }
      return d
    }
  }
}

export async function triggerMailFetch(
  formData: FormData,
): Promise<{ ok: true; jobId: number } | { ok: false; error: string }> {
  // Authorization throws (Unauthorized / Forbidden) so unauthenticated /
  // member callers never reach the validate path; callers can rely on the
  // throw for the authn/authz gate just like the other actions in this file.
  const session = await requireAdminSession()

  const raw = {
    preset: formData.get('preset'),
    // FormData.get returns FormDataEntryValue | null; z.string() rejects
    // anything but string so a missing field surfaces as invalid form input.
    customDate: formData.get('customDate') ?? undefined,
  }
  const parsed = triggerMailFetchSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'invalid form input' }
  }

  let since: Date
  try {
    since = computeSince(parsed.data)
  } catch {
    return { ok: false, error: 'invalid form input' }
  }

  // Future-dated `since` makes no semantic sense (the IMAP fetch would return
  // zero rows and waste a worker cycle). Cheaper to refuse here than to let
  // the dispatcher discover it.
  if (since.getTime() > Date.now()) {
    return { ok: false, error: 'since が未来日付です' }
  }

  const inserted = await db
    .insert(mailWorkerJobs)
    .values({
      requestedByUserId: session.user.id,
      since,
      status: 'pending',
    })
    .returning({ id: mailWorkerJobs.id })
  const job = inserted[0]
  if (!job) throw new Error('mail_worker_jobs insert failed')

  revalidatePath('/admin/mail-inbox')
  return { ok: true, jobId: job.id }
}

// ─────────────────────────────────────────────────────────────────────────
// tournament-results Task3: 結果 Excel 取込トリガ
//
// mail-inbox 詳細の「結果として取り込む」ボタンから呼ばれる。
// .xls/.xlsx 添付を指定して result_parse ジョブをキューに積む。
// mail-worker の extract-only timer（30 秒間隔）が拾って runResultParse を実行。
//
// 既存 result_draft の状態によるガード:
//   pending_review → エラー「承認待ちのドラフトがあります」
//   approved       → エラー「承認済みです」
//   parse_failed   → 再試行可（再キュー可）
//   rejected       → 再試行可（再キュー可）
//   superseded     → 再試行可（再キュー可）
// ─────────────────────────────────────────────────────────────────────────

export async function triggerResultParse(
  mailId: number,
  attachmentId: number,
): Promise<{ ok: true; jobId: number } | { ok: false; error: string }> {
  const session = await requireAdminSession()

  try {
    const result = await db.transaction(async (tx) => {
      // Verify attachment belongs to this mail and is an Excel file.
      const attRows = await tx
        .select({
          id: mailAttachments.id,
          mailMessageId: mailAttachments.mailMessageId,
          filename: mailAttachments.filename,
        })
        .from(mailAttachments)
        .where(eq(mailAttachments.id, attachmentId))
        .limit(1)
      if (attRows.length === 0) throw new Error('添付ファイルが見つかりません')
      const att = attRows[0]!
      if (att.mailMessageId !== mailId) {
        throw new Error('指定された添付ファイルはこのメールに属していません')
      }
      const lower = att.filename.toLowerCase()
      if (!lower.endsWith('.xls') && !lower.endsWith('.xlsx')) {
        throw new Error('Excel ファイル (.xls/.xlsx) のみ取り込めます')
      }

      // Check existing result_draft state.
      const existingDraft = await tx
        .select({ id: resultDrafts.id, status: resultDrafts.status })
        .from(resultDrafts)
        .where(eq(resultDrafts.messageId, mailId))
        .limit(1)
      if (existingDraft.length > 0) {
        const ds = existingDraft[0]!.status
        if (ds === 'pending_review') {
          throw new Error('既に承認待ちの結果ドラフトがあります')
        }
        if (ds === 'approved') {
          throw new Error('既に承認済みの結果ドラフトがあります')
        }
        // parse_failed / rejected / superseded → allow re-queue
      }

      const insertedJob = await tx
        .insert(mailWorkerJobs)
        .values({
          requestedByUserId: session.user.id,
          status: 'pending',
          kind: 'result_parse',
          payload: { mail_message_id: mailId, attachment_id: attachmentId },
        })
        .returning({ id: mailWorkerJobs.id })
      return { jobId: insertedJob[0]!.id }
    })

    revalidatePath('/admin/mail-inbox')
    revalidatePath(`/admin/mail-inbox/mail/${mailId}`)
    return { ok: true, jobId: result.jobId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// tournament-results Task4: レビュー承認/却下
// ─────────────────────────────────────────────────────────────────────────────

export async function approveResultDraft(
  draftId: number,
  formData: FormData,
): Promise<{ ok: true; tournamentId: number } | { ok: false; error: string }> {
  const session = await requireAdminSession()

  const tournamentName = (formData.get('tournamentName') as string | null)?.trim()
  if (!tournamentName) return { ok: false, error: '大会名を入力してください' }

  const eventDateRaw = ((formData.get('eventDate') as string | null) ?? '').trim() || null
  const venue = ((formData.get('venue') as string | null) ?? '').trim() || null

  const { ParsedResultPayloadSchema } = await import(
    '@kagetra/mail-worker/result-import/schema'
  )

  try {
    // Fetch + status-check + state transition must be atomic. Two concurrent
    // approvals could otherwise both read pending_review outside the tx and both
    // materialize, duplicating tournaments/classes/participants/matches and
    // orphaning the first tournament (Codex R1 blocker). We lock the draft row
    // with FOR UPDATE and re-check status inside the tx, so only the first
    // request claims it; the second sees the transitioned status and bails.
    const result = await db.transaction(
      async (
        tx,
      ): Promise<
        | { ok: false; error: string }
        | { ok: true; tournamentId: number; messageId: number }
      > => {
        const lockedRows = await tx
          .select({
            id: resultDrafts.id,
            status: resultDrafts.status,
            messageId: resultDrafts.messageId,
            extractedPayload: resultDrafts.extractedPayload,
          })
          .from(resultDrafts)
          .where(eq(resultDrafts.id, draftId))
          .for('update')
        const draft = lockedRows[0]
        if (!draft) return { ok: false, error: '結果ドラフトが見つかりません' }
        if (draft.status !== 'pending_review') {
          return { ok: false, error: `このドラフトは承認できない状態です (${draft.status})` }
        }

        const parsed = ParsedResultPayloadSchema.safeParse(draft.extractedPayload)
        if (!parsed.success) {
          return { ok: false, error: `ペイロードの解析に失敗しました: ${parsed.error.message}` }
        }

        const { tournamentId } = await materializeResultDraft(tx, parsed.data, {
          tournamentName,
          eventDate: eventDateRaw,
          venue,
          sourceResultDraftId: draftId,
        })

        await tx
          .update(resultDrafts)
          .set({
            status: 'approved',
            tournamentId,
            approvedByUserId: session.user.id,
            approvedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(resultDrafts.id, draftId))

        await tx
          .update(mailMessages)
          .set({
            triageStatus: 'processed',
            triagedAt: sql`now()`,
            triagedByUserId: session.user.id,
            updatedAt: sql`now()`,
          })
          .where(eq(mailMessages.id, draft.messageId))

        return { ok: true, tournamentId, messageId: draft.messageId }
      },
    )

    if (!result.ok) return { ok: false, error: result.error }

    revalidatePath('/admin/mail-inbox')
    revalidatePath(`/admin/mail-inbox/result-drafts/${draftId}`)
    revalidatePath(`/admin/mail-inbox/mail/${result.messageId}`)
    return { ok: true, tournamentId: result.tournamentId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function rejectResultDraft(
  draftId: number,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminSession()

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { ok: false, error: '却下理由を入力してください' }

  try {
    // Status-guarded atomic transition (Codex R2 blocker: an unguarded reject
    // racing an approve could flip an already-approved draft to rejected while
    // its tournaments/classes/participants/matches + mail=processed remain). The
    // UPDATE only fires when the draft is still rejectable; the returning-row
    // count tells us whether we won the transition.
    const updated = await db
      .update(resultDrafts)
      .set({
        status: 'rejected',
        rejectedByUserId: session.user.id,
        rejectedAt: sql`now()`,
        rejectionReason: trimmedReason,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(resultDrafts.id, draftId),
          inArray(resultDrafts.status, ['pending_review', 'parse_failed']),
        ),
      )
      .returning({ id: resultDrafts.id, messageId: resultDrafts.messageId })

    if (updated.length === 0) {
      // Nothing transitioned: either the draft doesn't exist or it already
      // moved out of a rejectable state (e.g. approved by a concurrent request).
      // Disambiguate with a follow-up read for a friendly message.
      const current = await db.query.resultDrafts.findFirst({
        where: eq(resultDrafts.id, draftId),
        columns: { status: true },
      })
      if (!current) return { ok: false, error: '結果ドラフトが見つかりません' }
      return { ok: false, error: `このドラフトは却下できない状態です (${current.status})` }
    }

    revalidatePath('/admin/mail-inbox')
    revalidatePath(`/admin/mail-inbox/result-drafts/${draftId}`)
    revalidatePath(`/admin/mail-inbox/mail/${updated[0]!.messageId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
