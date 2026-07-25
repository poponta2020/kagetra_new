import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { events, eventGradeBroadcasts, lineChannels, lineGradeGroupBindings } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import type { db as appDb } from '@/lib/db'
import { formatEventDate } from '@/app/(app)/events/event-list-utils'
import { getOrCreateShareToken } from '@/lib/attachment-image-render'
import { loadSystemChannel, pushSystemText } from '@/lib/entry-overdue-alert'

/**
 * event-grade-group-broadcast: 級別 (A〜E) LINE グループへ大会概要を自動配信する
 * コアロジック。requirements.md §3.2 / implementation-plan.md タスク2。
 *
 * 配信対象の定義は `line-grade-group-bindings.ts` のスキーマ docstring が唯一の正
 * （`status='linked'` かつ `line_group_id IS NOT NULL` の行だけ）。「行が存在する」で
 * 判定してはならない — 解除 (revoked) した級へ送り続けてしまう (AC-19)。
 *
 * `(大会, 級)` の冪等性は `event_grade_broadcasts` の **claim → push → 確定/取消**
 * 方式（`event-grade-broadcasts.ts` のスキーマ docstring と同じ契約）で担保する。
 * `INSERT ... ON CONFLICT DO NOTHING` にしない理由: push 途中でプロセスが落ちると
 * `sent_at IS NULL` の claim 行が残り、その `(大会, 級)` が永久に送信不能になる
 * （再送ボタンも静かにスキップする）。リースつき upsert にすることで、5分の
 * リース期限切れ後は再 claim できるようにしてある。
 *
 * `broadcastEventsToGradeGroups` は呼び出し側（`after()` の fire-and-forget）を
 * 壊さないため throw しない契約（要件 §3.2「配信処理が例外を投げた」= 登録処理は
 * 巻き戻さない）。内部の失敗は戻り値のサマリーとロガーに落とす。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（entry-overdue-alert.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}
const NOOP_LOGGER: Logger = { info: () => undefined, warn: () => undefined }

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** claim のリース期間。この時間を超えて `sent_at IS NULL` のまま放置された claim は
 * 別プロセスが落ちたとみなして再 claim を許す（`event-grade-broadcasts.ts` 契約）。 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000

const ALL_GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E']

// ---------------------------------------------------------------------------
// 対象級の解決（純関数）
// ---------------------------------------------------------------------------

/**
 * `eligibleGrades` から配信対象級を解決する。null または空配列なら全5級
 * （アプリ内の申込可否判定 `isGradeEligible`（event-list-utils.ts）と同じルール）。
 * 戻り値は A→E の固定順（重複を排し、複数 event を級ごとに束ねる際の決定的な
 * 反復順を得るため）。
 */
export function resolveTargetGrades(eligibleGrades: Grade[] | null | undefined): Grade[] {
  if (!eligibleGrades || eligibleGrades.length === 0) return [...ALL_GRADES]
  const set = new Set(eligibleGrades)
  return ALL_GRADES.filter((g) => set.has(g))
}

// ---------------------------------------------------------------------------
// 文面組み立て（純関数）
// ---------------------------------------------------------------------------

export interface GradeBroadcastEntry {
  /** 'YYYY-MM-DD'。1行目の日付表記に使う。 */
  eventDate: string
  title: string
  /** 要綱の共有 URL。未選択 (NULL) なら 2行目を省略する。 */
  guidelineUrl: string | null
  /** `events.internal_deadline`。NULL なら締切行（空行込み）を省略する。 */
  internalDeadline: string | null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 締切行専用の `M/D` 整形（曜日なし・ゼロ埋めなし）。1行目の日付は
 * `formatEventDate`（`M/D(曜)`）を使うため、意図的に別関数として持つ。
 * 不正形式は入力をそのまま返す（防御的。呼び出し元は DB の date 列を渡す前提）。
 */
function formatMD(dateIso: string): string {
  const m = DATE_RE.exec(dateIso)
  if (!m) return dateIso
  return `${Number(m[2])}/${Number(m[3])}`
}

/**
 * 1件分の文面を組み立てる。要件 §3.2「文面」の現物:
 *
 * ```
 * 8/15(土) 大阪ABの案内が来ました！
 * https://…/api/line-broadcast/attachments/{token}
 *
 * 締切 は7/25です。
 * ```
 *
 * 要綱 URL 行は `guidelineUrl` が null なら省略。締切行は「空行 + 締切行」を
 * セットで省略する（`internalDeadline` が null のとき）。
 */
function buildEntryText(entry: GradeBroadcastEntry): string {
  const lines: string[] = [`${formatEventDate(entry.eventDate)} ${entry.title}の案内が来ました！`]
  if (entry.guidelineUrl) {
    lines.push(entry.guidelineUrl)
  }
  if (entry.internalDeadline) {
    lines.push('')
    lines.push(`締切 は${formatMD(entry.internalDeadline)}です。`)
  }
  return lines.join('\n')
}

/** 複数件を区切り線で連結する。区切り線は実装とテストで一貫させる素朴な形。 */
const ENTRY_SEPARATOR = '\n---\n'

/**
 * 純関数。同じ級グループへまとめて送る `entries`（1回の承認で複数 event が
 * 作られ同じ級に該当する場合の束ね。AC-10）を1通の文面へ組み立てる。
 */
export function buildGradeBroadcastMessage(entries: GradeBroadcastEntry[]): string {
  return entries.map(buildEntryText).join(ENTRY_SEPARATOR)
}

// ---------------------------------------------------------------------------
// baseUrl 解決（line-broadcast-guidelines.ts / entry-overdue-alert.ts と同方針。
// 重依存を避けるため import せずコピーする既存慣行）
// ---------------------------------------------------------------------------

function resolveBaseUrl(override?: string): string {
  const candidate = override ?? process.env.PUBLIC_BASE_URL
  if (!candidate) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured. event-grade-broadcast requires an absolute URL for guideline links.',
    )
  }
  if (!/^https:\/\//i.test(candidate)) {
    throw new Error(
      `PUBLIC_BASE_URL must use https:// (got "${candidate}"). LINE では裸のホストや http はタップ可能なリンクにならない。`,
    )
  }
  return candidate.replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// 級グループ紐付けの解決（配信対象の定義はここが唯一の正の実装）
// ---------------------------------------------------------------------------

interface LinkedBinding {
  lineGroupId: string
  channelAccessToken: string
}

/**
 * 配信するのは `status='linked'` かつ `line_group_id IS NOT NULL` の行だけ
 * （line-grade-group-bindings.ts docstring）。SELECT する列も契約どおり
 * `grade` / `lineGroupId` / `lineChannelId` 経由の `channelAccessToken` のみ。
 */
async function loadLinkedBindings(
  dbc: DbOrTx,
  grades: Grade[],
): Promise<Map<Grade, LinkedBinding>> {
  const map = new Map<Grade, LinkedBinding>()
  if (grades.length === 0) return map

  const rows = await dbc
    .select({
      grade: lineGradeGroupBindings.grade,
      lineGroupId: lineGradeGroupBindings.lineGroupId,
      channelAccessToken: lineChannels.channelAccessToken,
    })
    .from(lineGradeGroupBindings)
    .innerJoin(lineChannels, eq(lineChannels.id, lineGradeGroupBindings.lineChannelId))
    .where(and(eq(lineGradeGroupBindings.status, 'linked'), inArray(lineGradeGroupBindings.grade, grades)))

  for (const row of rows) {
    // status='linked' でも念のため NULL 防御（スキーマ上 nullable のため）。
    if (!row.lineGroupId) continue
    map.set(row.grade, { lineGroupId: row.lineGroupId, channelAccessToken: row.channelAccessToken })
  }
  return map
}

// ---------------------------------------------------------------------------
// claim（リースつき upsert）
// ---------------------------------------------------------------------------

/**
 * `(event_id, grade)` の claim を取る。RETURNING が行を返すのは「新規 claim」か
 * 「放置された claim の再取得」のときだけ:
 *   - `sent_at IS NOT NULL` → 送信済み。2回目は送らない (AC-8)
 *   - `leaseMs` 以内の claim → 別プロセスが送信中。二重 push を避ける
 * `event-grade-broadcasts.ts` の docstring に定義された契約どおりのリースつき
 * upsert（単純な `ON CONFLICT DO NOTHING` にしない理由もそちらに記載）。
 */
async function claimBroadcast(
  dbc: DbOrTx,
  eventId: number,
  grade: Grade,
  leaseMs: number,
): Promise<number | null> {
  const rows = await dbc
    .insert(eventGradeBroadcasts)
    .values({ eventId, grade })
    .onConflictDoUpdate({
      target: [eventGradeBroadcasts.eventId, eventGradeBroadcasts.grade],
      set: { claimedAt: sql`now()` },
      setWhere: sql`${eventGradeBroadcasts.sentAt} IS NULL AND ${eventGradeBroadcasts.claimedAt} < now() - (${leaseMs} * interval '1 millisecond')`,
    })
    .returning({ id: eventGradeBroadcasts.id })
  return rows[0]?.id ?? null
}

// ---------------------------------------------------------------------------
// push（1級グループへ text 1通。line-broadcast-guidelines.ts の pushGuidelineMessages
// を1通版に簡略化。配信本文・チャネルアクセストークンはログへ出力しない）
// ---------------------------------------------------------------------------

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const PUSH_TIMEOUT_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 3

interface PushGradeResult {
  ok: boolean
  httpStatus: number | null
  reason?: string
}

async function pushGradeText(
  fetchImpl: typeof fetch,
  channelAccessToken: string,
  to: string,
  text: string,
  logger: Logger,
): Promise<PushGradeResult> {
  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping grade broadcast push', { to })
    return { ok: true, httpStatus: null }
  }

  let attempt = 0
  for (;;) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS)
    try {
      const res = await fetchImpl(LINE_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) return { ok: true, httpStatus: res.status }

      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfterSec = Number(res.headers.get('retry-after'))
        const waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.min(retryAfterSec, 60) * 1000 : 5000
        logger.warn('grade broadcast push 429, retrying after Retry-After', {
          attempt: attempt + 1,
          waitMs,
        })
        await sleep(waitMs)
        attempt++
        continue
      }

      const body = await res.text().catch(() => '')
      logger.warn('grade broadcast push failed', { httpStatus: res.status })
      return {
        ok: false,
        httpStatus: res.status,
        reason: `LINE push failed: ${res.status} ${body.slice(0, 200)}`,
      }
    } catch (err) {
      clearTimeout(timer)
      const isAbort = err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
      const reason = isAbort
        ? 'LINE push timed out after 30s'
        : err instanceof Error
          ? err.message
          : String(err)
      logger.warn('grade broadcast push failed', { error: reason })
      return { ok: false, httpStatus: null, reason }
    }
  }
}

// ---------------------------------------------------------------------------
// 管理者通知（未紐付けスキップ・push 失敗を集計して1通。entry-overdue-alert.ts の
// loadSystemChannel / pushSystemText を再利用する。両方とも throw しない契約なので
// ここでも throw しない）
// ---------------------------------------------------------------------------

/**
 * `system_notify` チャネルが解決できた（= 実際に通知を試みた）ときだけ `true` を
 * 返す。呼び出し側の `result.notified` はこの戻り値で決める — `notifyAdmin` 自体は
 * `loadSystemChannel`/`pushSystemText` が throw しない契約なので常に正常終了するが、
 * チャネル未設定の「何もしなかった」ケースまで `notified: true` にすると呼び出し側
 * が誤って通知成功と解釈してしまう。
 */
async function notifyAdmin(
  dbc: DbOrTx,
  skippedGrades: Grade[],
  failedGrades: Grade[],
  opts: { logger: Logger; fetchImpl: typeof fetch },
): Promise<boolean> {
  const channel = await loadSystemChannel(dbc, opts.logger)
  if (!channel || !channel.notificationLineUserId) return false

  const lines: string[] = ['⚠️ 級別グループ配信で問題がありました']
  if (skippedGrades.length > 0) {
    lines.push(`未紐付けでスキップ: ${skippedGrades.join('/')}`)
  }
  if (failedGrades.length > 0) {
    lines.push(`送信失敗: ${failedGrades.join('/')}`)
  }

  await pushSystemText(
    { channelAccessToken: channel.channelAccessToken, notificationLineUserId: channel.notificationLineUserId },
    lines.join('\n'),
    { logger: opts.logger, fetchImpl: opts.fetchImpl },
  )
  return true
}

// ---------------------------------------------------------------------------
// 束ね: broadcastEventsToGradeGroups
// ---------------------------------------------------------------------------

interface TargetEventRow {
  id: number
  title: string
  eventDate: string
  internalDeadline: string | null
  eligibleGrades: Grade[] | null
  gradeBroadcastAttachmentId: number | null
}

export interface BroadcastEventsToGradeGroupsOptions {
  /** テスト用に fetch を差し替える。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch
  /** 要綱共有トークンの発行時刻注入（テスト用）。既定は `new Date()`。 */
  now?: Date
  logger?: Logger
  /** 既定は process.env.PUBLIC_BASE_URL。 */
  baseUrl?: string
  /** claim のリース期間 (ms)。既定は {@link CLAIM_LEASE_MS}。テストで短縮する用途。 */
  claimLeaseMs?: number
}

export interface BroadcastEventsToGradeGroupsResult {
  /** push が成功し `sent_at` を確定した級。 */
  sentGrades: Grade[]
  /** 対象だが未紐付け（linked 行が無い）でスキップした級。 */
  skippedGrades: Grade[]
  /** claim は取れたが push が失敗し claim を取り消した級。 */
  failedGrades: Grade[]
  /** 未紐付け/失敗があり管理者通知を送った (loadSystemChannel が有効だった) か。 */
  notified: boolean
}

function emptyResult(): BroadcastEventsToGradeGroupsResult {
  return { sentGrades: [], skippedGrades: [], failedGrades: [], notified: false }
}

/**
 * `eventIds` を級ごとに束ねて配信する。手順（requirements.md §3.2 / タスク2 契約）:
 *
 * 1. `eventIds` から対象 events を取得し、各 event の `eligibleGrades` から
 *    `resolveTargetGrades` で対象級を求め、級ごとに event 群へ束ねる
 * 2. 級ごとに紐付け (`status='linked'` かつ `lineGroupId` あり) を解決。無ければ
 *    その級はスキップ (skippedGrades) — 他の級へは送る (AC-4)
 * 3. 紐付けがある級は、束ねた各 event について `claimBroadcast` で `(event, grade)`
 *    を claim する。claim できた（=未送信 or リース切れ）event だけを文面へ含める
 * 4. claim が1件も取れなければ（=既に全て送信済み、または別プロセスが処理中）
 *    push しない (AC-8 の二重送信防止)
 * 5. push 成功 → claim した行の `sent_at` を確定 (sentGrades)。
 *    push 失敗 → claim した行を `sent_at IS NULL` ガード付きで DELETE し、
 *    未送信のまま残す (failedGrades)。**紐付けは解除しない**
 * 6. skippedGrades / failedGrades があれば `loadSystemChannel` + `pushSystemText`
 *    で管理者へ1通通知する
 *
 * 呼び出し側（`after()` の fire-and-forget）を壊さないため、想定外の例外を含め
 * throw しない。内部の失敗は戻り値のサマリーとロガーに落とす。全級未紐付けでも
 * 正常終了する (AC-3)。級ごとの処理は個別に try/catch し、1級で想定外の例外
 * （例: 添付が消えていて `getOrCreateShareToken` が失敗）が起きても他の級の
 * 処理は継続する。孤立した claim 行はガード付き DELETE で必ず後始末する。
 */
export async function broadcastEventsToGradeGroups(
  db: Database,
  eventIds: number[],
  options: BroadcastEventsToGradeGroupsOptions = {},
): Promise<BroadcastEventsToGradeGroupsResult> {
  const logger = options.logger ?? NOOP_LOGGER
  const fetchImpl = options.fetchImpl ?? fetch
  const leaseMs = options.claimLeaseMs ?? CLAIM_LEASE_MS
  const result = emptyResult()

  if (eventIds.length === 0) return result

  try {
    const rows: TargetEventRow[] = await db
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        internalDeadline: events.internalDeadline,
        eligibleGrades: events.eligibleGrades,
        gradeBroadcastAttachmentId: events.gradeBroadcastAttachmentId,
      })
      .from(events)
      .where(inArray(events.id, eventIds))
      .orderBy(asc(events.id))

    if (rows.length === 0) return result

    // ① 級ごとに対象 event 群を束ねる（安定した反復順のため Map に A→E 順で積む）。
    const eventsByGrade = new Map<Grade, TargetEventRow[]>()
    for (const row of rows) {
      for (const grade of resolveTargetGrades(row.eligibleGrades)) {
        const list = eventsByGrade.get(grade)
        if (list) {
          list.push(row)
        } else {
          eventsByGrade.set(grade, [row])
        }
      }
    }
    if (eventsByGrade.size === 0) return result

    // ② 紐付け解決（配信対象の定義はここが唯一の正）。
    const bindings = await loadLinkedBindings(db, [...eventsByGrade.keys()])

    // baseUrl は claim を取る**前**に一度だけ検証する。claim 後（push 前）に
    // 例外が飛ぶと、その級の claim 行が `sent_at IS NULL` のまま孤立し、5分の
    // リース失効まで再送不能になる（`event-grade-broadcasts.ts` の claim 契約）。
    // 紐付けが1つも無ければ検証自体スキップする（PUBLIC_BASE_URL 未設定の環境で
    // 級グループ未設定のうちから例外にしないため）。
    let baseUrl: string | null = null
    if (bindings.size > 0) {
      try {
        baseUrl = resolveBaseUrl(options.baseUrl)
      } catch (err) {
        logger.warn('broadcastEventsToGradeGroups: baseUrl resolution failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        // 要綱 URL を解決できず紐付け済みの級へは1つも送れないため、全て失敗として扱う。
        for (const grade of bindings.keys()) result.failedGrades.push(grade)
      }
    }

    // ③ 級ごとに claim → 文面 → push → 確定/取消。1級の失敗が他級を巻き込まない
    // よう級単位で try/catch する（AC-4 の「他の級へは送る」を例外系でも保つ）。
    for (const [grade, gradeEvents] of eventsByGrade) {
      const binding = bindings.get(grade)
      if (!binding) {
        result.skippedGrades.push(grade)
        continue
      }
      if (baseUrl == null) continue // 上で baseUrl 解決失敗として既に failedGrades 済み

      const claimed: { id: number; event: TargetEventRow }[] = []
      try {
        for (const event of gradeEvents) {
          const claimId = await claimBroadcast(db, event.id, grade, leaseMs)
          if (claimId != null) claimed.push({ id: claimId, event })
        }
        // 既に全て送信済み、または別プロセスがリース中 — 二重送信を避けるため何もしない。
        if (claimed.length === 0) continue

        const entries: GradeBroadcastEntry[] = []
        for (const { event } of claimed) {
          let guidelineUrl: string | null = null
          if (event.gradeBroadcastAttachmentId != null) {
            const { token } = await getOrCreateShareToken(db, event.gradeBroadcastAttachmentId, {
              now: options.now,
            })
            guidelineUrl = `${baseUrl}/api/line-broadcast/attachments/${token}`
          }
          entries.push({
            eventDate: event.eventDate,
            title: event.title,
            guidelineUrl,
            internalDeadline: event.internalDeadline,
          })
        }
        const text = buildGradeBroadcastMessage(entries)
        const claimedIds = claimed.map((c) => c.id)

        const pushResult = await pushGradeText(fetchImpl, binding.channelAccessToken, binding.lineGroupId, text, logger)

        if (pushResult.ok) {
          await db
            .update(eventGradeBroadcasts)
            .set({ sentAt: sql`now()` })
            .where(inArray(eventGradeBroadcasts.id, claimedIds))
          result.sentGrades.push(grade)
        } else {
          // 未送信のまま残す（紐付けは解除しない）。後から再送できるようにする (AC-9 / AC-21)。
          await db
            .delete(eventGradeBroadcasts)
            .where(and(inArray(eventGradeBroadcasts.id, claimedIds), sql`${eventGradeBroadcasts.sentAt} IS NULL`))
          result.failedGrades.push(grade)
        }
      } catch (err) {
        logger.warn('broadcastEventsToGradeGroups: grade processing failed', {
          grade,
          error: err instanceof Error ? err.message : String(err),
        })
        // ここまでに claim できていた分だけ後始末する（claim 前に落ちていれば空配列）。
        if (claimed.length > 0) {
          await db
            .delete(eventGradeBroadcasts)
            .where(
              and(
                inArray(
                  eventGradeBroadcasts.id,
                  claimed.map((c) => c.id),
                ),
                sql`${eventGradeBroadcasts.sentAt} IS NULL`,
              ),
            )
            .catch(() => undefined)
        }
        result.failedGrades.push(grade)
      }
    }
  } catch (err) {
    logger.warn('broadcastEventsToGradeGroups: unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ④ 未紐付け/失敗があれば管理者へ1通通知する（loadSystemChannel/pushSystemText は
  // throw しない契約だが、念のため外側で捕捉して throw しない契約を守る）。
  if (result.skippedGrades.length > 0 || result.failedGrades.length > 0) {
    try {
      result.notified = await notifyAdmin(db, result.skippedGrades, result.failedGrades, { logger, fetchImpl })
    } catch (err) {
      logger.warn('broadcastEventsToGradeGroups: admin notification failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
