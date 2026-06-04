'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  eventGroups,
  events,
  mailMessages,
  mailWorkerJobs,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import {
  eventFormSchema,
  extractEventFormData,
  extractEventUnitsFormData,
} from '@/lib/form-schemas'
import { broadcastMailToEvent, loadActiveBinding } from '@/lib/line-broadcast'
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

  // Mirror events/new (apps/web/src/app/(app)/events/new/page.tsx) so an
  // approval through the inbox produces the same FK-validated row a manual
  // create would, instead of letting a stale group_id bubble up as a 500.
  if (parsed.eventGroupId != null) {
    const group = await db.query.eventGroups.findFirst({
      where: eq(eventGroups.id, parsed.eventGroupId),
      columns: { id: true },
    })
    if (!group) {
      throw new Error('入力が不正です: 指定された大会グループが存在しません')
    }
  }

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

  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    columns: {
      status: true,
      messageId: true,
      isCorrection: true,
      extractedPayload: true,
    },
  })
  if (!draft) throw new Error('draft not found')
  if (!APPROVABLE_STATUSES.includes(draft.status as (typeof APPROVABLE_STATUSES)[number])) {
    throw new Error('draft is not approvable')
  }

  // r3 should_fix: only accept unit_keys that actually belong to this draft's
  // payload. A tampered / stale client form could otherwise POST an arbitrary
  // unit_key and create an `events` row whose tournament_draft_unit_key has no
  // counterpart in the draft — polluting the materialize/complete reconciliation.
  // extractPayloadUnitKeys mirrors ApprovalForm.normalizeUnits (legacy/null → 'u1').
  const allowedUnitKeys = new Set(extractPayloadUnitKeys(draft.extractedPayload))
  for (const unit of units) {
    if (!allowedUnitKeys.has(unit.unitKey)) {
      throw new Error(`入力が不正です: 未知のイベント単位 (${unit.unitKey})`)
    }
  }

  // Validate every selected unit BEFORE opening the transaction so a bad unit
  // aborts the whole batch without a partial INSERT — same FK-validation as
  // events/new / approveDraft, applied per unit.
  const parsedUnits = units.map((unit) => ({
    unitKey: unit.unitKey,
    eligibleGrades: unit.eligibleGrades,
    parsed: eventFormSchema.parse(unit.data),
  }))
  for (const { parsed } of parsedUnits) {
    if (parsed.eventGroupId != null) {
      const group = await db.query.eventGroups.findFirst({
        where: eq(eventGroups.id, parsed.eventGroupId),
        columns: { id: true },
      })
      if (!group) {
        throw new Error('入力が不正です: 指定された大会グループが存在しません')
      }
    }
  }

  const createdEventIds: number[] = []
  let approvedMailMessageId: number | null = null
  let approvedIsCorrection = false
  let didFinalize = false

  await db.transaction(async (tx) => {
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

    // Decide whether the draft is now fully materialized: every unit_key in the
    // payload must have a corresponding events row (tournament_draft_id =
    // draftId). Read the materialized set inside the tx so the units we just
    // inserted are counted.
    const payloadUnitKeys = extractPayloadUnitKeys(draft.extractedPayload)
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
  // 配信はしたいので draft.messageId を使う (常に同一メールを指す)。
  if (createdEventIds.length > 0) {
    const eventIds = createdEventIds
    const mailMessageId = approvedMailMessageId ?? draft.messageId
    const isCorrection = didFinalize ? approvedIsCorrection : draft.isCorrection
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

  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    columns: { status: true, messageId: true },
  })
  if (!draft) throw new Error('draft not found')
  if (!APPROVABLE_STATUSES.includes(draft.status as (typeof APPROVABLE_STATUSES)[number])) {
    throw new Error('draft is not approvable')
  }

  // r3 blocker: completeDraft は「一部登録した後、残りの単位を作らずに閉じる」
  // 導線。1 件も materialize していない draft をこれで閉じると、大会案内メールを
  // 0 イベントのまま processed にして取りこぼす。1 件以上の作成を必須にし、0 件で
  // 閉じたいケースは reject に誘導する（UI 側もボタンを出さない）。
  const materialized = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.tournamentDraftId, draftId))
    .limit(1)
  if (materialized.length === 0) {
    throw new Error(
      '作成済みイベントがありません。先にイベントを登録するか、却下してください',
    )
  }

  await db.transaction(async (tx) => {
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
      })
    if (updated.length === 0) {
      throw new Error('draft is not approvable')
    }

    await tx
      .update(mailMessages)
      .set({
        status: 'archived',
        triageStatus: 'processed',
        triagedAt: sql`now()`,
        triagedByUserId: session.user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(mailMessages.id, updated[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

/**
 * Throw if any events row was already materialized from this draft
 * (tournament_title-grade-split review CRITICAL-3). Once a unit has been
 * approved into an event, the draft is mid-flight: rejecting it (→ rejected)
 * or re-pointing it at a single existing event (linkDraftToEvent) would leave
 * orphaned created events behind while the draft claims a contradictory
 * terminal state. The only valid close path for a partially-approved draft is
 * completeDraft (approve the rest, or finish without them).
 */
async function assertNoMaterializedEvents(
  draftId: number,
  message: string,
): Promise<void> {
  const materialized = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.tournamentDraftId, draftId))
    .limit(1)
  if (materialized.length > 0) throw new Error(message)
}

export async function rejectDraft(draftId: number, formData: FormData) {
  const session = await requireAdminSession()

  const reasonRaw = formData.get('rejection_reason')
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : ''
  if (!reason) throw new Error('却下理由は必須です')

  // CRITICAL-3 二重防御: a draft with already-created events must not be
  // rejected (the UI hides the reject form in this case, but guard the action
  // too). Run before the transaction so nothing mutates on the bad path.
  await assertNoMaterializedEvents(
    draftId,
    '作成済みイベントがあるため却下できません',
  )

  // event_id is intentionally not touched here: rejection doesn't link to an
  // event, and a previously linked draft being re-rejected keeps its history.
  // Status guard prevents flipping an already-finalized draft (approved /
  // rejected / superseded) via direct call.
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(tournamentDrafts)
      .set({
        status: 'rejected',
        rejectedByUserId: session.user.id,
        rejectedAt: sql`now()`,
        rejectionReason: reason,
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
      })

    if (updated.length === 0) {
      throw new Error('draft is not rejectable')
    }

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
  // (requirements §3.4 再 AI 抽出のガード).
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
  await persistOutcome(db, draft.messageId, outcome)

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function linkDraftToEvent(draftId: number, eventId: number) {
  const session = await requireAdminSession()

  // CRITICAL-3 二重防御: linking points the draft at a single existing event,
  // which contradicts a draft that already split into its own created events.
  // Refuse so the partial-approval state can't be silently overwritten. The UI
  // also hides the link form once any unit is materialized.
  await assertNoMaterializedEvents(
    draftId,
    '作成済みイベントがあるため紐付けできません',
  )

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
    const updated = await tx
      .update(tournamentDrafts)
      .set({
        status: 'approved',
        eventId,
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
// ドラフトの有無に関わらず任意の mail_messages 行を processed / deferred /
// unprocessed に遷移させる。未処理バッジ件数は `triage_status != 'processed'`
// (unprocessed + deferred) で数えるので、deferMail は意図的にバッジに残す。
//
// approve/reject/link は status='archived' も伴う「ドラフト処理」だが、以下は
// triage_status だけを動かす軽量操作で status(AI/技術状態)は保持する。
// undoTriage はどの processed でも素直に unprocessed へ戻す（承認済みメールを
// 戻すかは呼び出し側 UI が出すアクションで制御する想定）。
// ─────────────────────────────────────────────────────────────────────────

async function setTriage(
  mailId: number,
  triageStatus: 'processed' | 'deferred' | 'unprocessed',
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

/** 対応不要として片付ける（→ processed、未処理バッジから除外）。 */
export async function dismissMail(mailId: number) {
  const session = await requireAdminSession()
  await setTriage(mailId, 'processed', session.user.id)
}

/** 保留（→ deferred、未処理バッジには残す）。 */
export async function deferMail(mailId: number) {
  const session = await requireAdminSession()
  await setTriage(mailId, 'deferred', session.user.id)
}

/** 処理取り消し / 保留解除（→ unprocessed、処理者をクリア）。 */
export async function undoTriage(mailId: number) {
  await requireAdminSession()
  await setTriage(mailId, 'unprocessed', null)
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
