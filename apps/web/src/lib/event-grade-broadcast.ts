import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { events, eventGradeBroadcasts, lineChannels, lineGradeGroupBindings } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import type { db as appDb } from '@/lib/db'
import { formatEventDate } from '@/app/(app)/events/event-list-utils'
import { getOrCreateShareToken } from '@/lib/attachment-image-render'
import { loadSystemChannel, pushSystemText } from '@/lib/entry-overdue-alert'
import { splitForLine } from '@/lib/text-splitter'

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
interface ClaimedRow {
  id: number
  /** claim の ownership。確定・取消はこの値との一致を条件にする。 */
  claimedAt: Date
  /**
   * この行が属する送信試行の retry key。新規 claim では `freshKey` が入り、
   * 既に push 済み（確定だけ失敗した）行を再 claim した場合は**当時のキーが
   * そのまま返る**。同じキーで送り直せば LINE 側が重複排除する。
   */
  retryKey: string
}

async function claimBroadcast(
  dbc: DbOrTx,
  eventId: number,
  grade: Grade,
  leaseMs: number,
  freshKey: string,
): Promise<ClaimedRow | null> {
  // `claimed_at` は ownership の比較キーとして JS へ往復させる。Postgres の
  // timestamptz はマイクロ秒精度だが JS の Date はミリ秒までしか持たないため、
  // 素の `now()` だと往復で値が落ちて CAS が永久に一致しない。ミリ秒へ丸めて
  // 無損失に往復させる（リース判定は丸めても影響しない）。
  const claimNow = sql`date_trunc('milliseconds', now())`
  const rows = await dbc
    .insert(eventGradeBroadcasts)
    .values({ eventId, grade, retryKey: freshKey, claimedAt: claimNow })
    .onConflictDoUpdate({
      target: [eventGradeBroadcasts.eventId, eventGradeBroadcasts.grade],
      set: {
        claimedAt: claimNow,
        // 既にキーがあるなら**絶対に振り直さない**（過去の push と同じ試行として
        // 再開する）。無い場合だけ今回のキーを入れる。
        retryKey: sql`COALESCE(${eventGradeBroadcasts.retryKey}, EXCLUDED.retry_key)`,
      },
      setWhere: sql`${eventGradeBroadcasts.sentAt} IS NULL AND ${eventGradeBroadcasts.claimedAt} < now() - (${leaseMs} * interval '1 millisecond')`,
    })
    .returning({
      id: eventGradeBroadcasts.id,
      claimedAt: eventGradeBroadcasts.claimedAt,
      retryKey: eventGradeBroadcasts.retryKey,
    })
  const row = rows[0]
  if (!row) return null
  return { id: row.id, claimedAt: row.claimedAt, retryKey: row.retryKey ?? freshKey }
}

/**
 * claim を取り消す。**自分が取った claim（`claimed_at` 一致）だけ**を消す。
 * id だけを条件にすると、リース失効で別プロセスが再 claim した行を古いプロセスが
 * 消してしまい、そちらの送信が「未 claim」状態に戻る（review R2 blocker）。
 */
async function deleteOwnedClaims(dbc: DbOrTx, rows: ClaimedRow[]): Promise<void> {
  for (const row of rows) {
    await dbc
      .delete(eventGradeBroadcasts)
      .where(
        and(
          eq(eventGradeBroadcasts.id, row.id),
          eq(eventGradeBroadcasts.claimedAt, row.claimedAt),
          sql`${eventGradeBroadcasts.sentAt} IS NULL`,
        ),
      )
  }
}

// ---------------------------------------------------------------------------
// push（1級グループへ text 1通。line-broadcast-guidelines.ts の pushGuidelineMessages
// を1通版に簡略化。配信本文・チャネルアクセストークンはログへ出力しない）
// ---------------------------------------------------------------------------

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const PUSH_TIMEOUT_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 3

/**
 * push の結末は 3 値で扱う（review R3 blocker）。
 *
 * - `accepted`: LINE が受理した（2xx、または同一 retry key の 409）。確定してよい
 * - `failed`: **受理されていないことが確か**（429 を除く 4xx 等）。claim を取り消して
 *   未送信へ戻してよい
 * - `unknown`: 受理されたかどうか分からない（タイムアウト・5xx・リトライ切れの 429）。
 *   **claim と retry_key を残す**。消して次回新しいキーで送ると、最初の要求が実は
 *   受理されていた場合に二重配信になる。LINE 公式も timeout / 5xx は同じ retry key で
 *   再試行するよう定めている
 */
type PushOutcome = 'accepted' | 'failed' | 'unknown'

interface PushGradeResult {
  outcome: PushOutcome
  httpStatus: number | null
  reason?: string
}

/**
 * 新規 claim 用の `X-Line-Retry-Key`（UUID）を1つ発行する。
 *
 * キーの**安定性は DB 側で担保する**: `claimBroadcast` は既存の `retry_key` が
 * あれば絶対に振り直さず（`COALESCE`）、再 claim でも当時のキーをそのまま返す。
 * したがってここで生成した値が使われるのは「まだ一度も push していない行」だけ。
 *
 * push が受理された後で確定 (`sent_at`) に失敗した／受理されたか不明なまま終わった
 * 場合も、次の試行は同じキーで送られるため LINE 側が重複排除する。
 *
 * `node:crypto` を使わず Web Crypto グローバルで書く（クライアントから import
 * され得るコードで node: を使わない、という規約に合わせる）。
 */
function newRetryKey(): string {
  // LINE は UUID 形式のみ受け付ける。`node:crypto` を使わず Web Crypto
  // グローバルで生成する（クライアントから import され得るコードで node: を
  // 使わない、という規約に合わせる）。
  return crypto.randomUUID()
}

/**
 * LINE の 1 リクエストあたりのメッセージ数上限。1 text = 5000 文字上限なので、
 * 束ねた本文が長い場合は分割してこの上限まで**同一リクエスト**に載せる
 * （リクエストを分けると retry key を共有できず冪等性が崩れる）。
 */
const LINE_MAX_MESSAGES_PER_PUSH = 5

async function pushGradeText(
  fetchImpl: typeof fetch,
  channelAccessToken: string,
  to: string,
  text: string,
  logger: Logger,
  retryKey: string,
): Promise<PushGradeResult> {
  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping grade broadcast push', { to })
    return { outcome: 'accepted', httpStatus: null }
  }

  // review R2 should_fix: 1 回の承認で同じ級に多数の大会が該当すると、束ねた本文が
  // LINE の 5000 文字上限を超えて恒久的に送信不能になる（再送も同じ入力で失敗する）。
  // 既存の splitForLine で分割し、1 リクエストに最大 5 通まで載せる。
  //
  // review R3 should_fix: 5 通に収まらない場合に切り捨ててはいけない。切り捨てたまま
  // 確定すると、末尾の大会が**一度も送られないのに送信済み**になり再送でも復旧できない。
  // 送らずに失敗として返し、claim を未送信へ戻す（運用では承認単位を分けて対処する）。
  const chunks = splitForLine(text)
  if (chunks.length > LINE_MAX_MESSAGES_PER_PUSH) {
    logger.warn('grade broadcast message exceeds LINE per-request limit; not sending', {
      to,
      chunkCount: chunks.length,
    })
    return {
      outcome: 'failed',
      httpStatus: null,
      reason: `本文が LINE の 1 リクエスト上限 (${LINE_MAX_MESSAGES_PER_PUSH} 通) を超えました`,
    }
  }
  const messages = chunks.map((chunk) => ({ type: 'text' as const, text: chunk }))

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
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({ to, messages }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) return { outcome: 'accepted', httpStatus: res.status }

      // 409 = 同じ retry key の push を LINE が既に受理済み。実配信は 1 回だけ
      // 行われているので「送信成功」として扱う（ここで失敗にすると claim を
      // 巻き戻して、次回さらに送ろうとしてしまう）。
      if (res.status === 409) {
        logger.info('grade broadcast push deduplicated by LINE (409)', { to })
        return { outcome: 'accepted', httpStatus: res.status }
      }

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
      // 5xx とリトライを使い切った 429 は「受理されたか不明」。claim と retry_key を
      // 残し、次回**同じキー**で再試行させる（消して新しいキーで送ると、最初の要求が
      // 実は受理されていた場合に二重配信になる）。それ以外の 4xx は受理されていないと
      // 確定できるので claim を取り消してよい。
      const ambiguous = res.status >= 500 || res.status === 429
      return {
        outcome: ambiguous ? 'unknown' : 'failed',
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
      // タイムアウト・ネットワーク断は受理されたか分からない。claim と retry_key を
      // 残して、同じキーでの再試行に委ねる（LINE 公式もこの経路は同一 retry key での
      // 再試行を求めている）。
      return { outcome: 'unknown', httpStatus: null, reason }
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
    //
    // review r1 should_fix: 解決するのは**要綱 URL を実際に載せる場合だけ**。
    // 紐付けの有無で判定すると、要綱添付が1件も無い（＝文面に URL 行が出ない）
    // 配信まで PUBLIC_BASE_URL 未設定で全滅する。手動作成の大会は常に添付なしなので、
    // その経路が env 不備で丸ごと落ちるのは実害が大きい。
    // review R3 should_fix: 失敗の巻き込み範囲は**級単位**にする。1件でも添付が
    // あるだけで全級を止めると、添付付き A 級と添付なし B 級を同時承認したときに
    // URL を必要としない B 級まで送られない（級ごとに失敗を分離する他の箇所とも不整合）。
    const needsBaseUrl = rows.some((row) => row.gradeBroadcastAttachmentId != null)
    let baseUrl: string | null = null
    let baseUrlError: string | null = null
    if (bindings.size > 0 && needsBaseUrl) {
      try {
        baseUrl = resolveBaseUrl(options.baseUrl)
      } catch (err) {
        baseUrlError = err instanceof Error ? err.message : String(err)
        logger.warn('broadcastEventsToGradeGroups: baseUrl resolution failed', {
          error: baseUrlError,
        })
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
      // baseUrl の解決に失敗していても、**その級に要綱添付が無ければ**文面に URL 行は
      // 出ないので普通に送れる。止めるのは URL を実際に必要とする級だけ。
      if (baseUrlError != null && gradeEvents.some((e) => e.gradeBroadcastAttachmentId != null)) {
        result.failedGrades.push(grade)
        continue
      }

      const claimed: { row: ClaimedRow; event: TargetEventRow }[] = []
      // review r1 blocker: LINE が push を受理したかどうかを catch 側からも見る。
      // 受理済みの claim を「失敗」として巻き戻すと、次回同じ本文を再送してしまう
      // （AC-8 違反）。確定 (`sent_at`) に失敗した曖昧な claim は**消さずに残す**。
      let anyPushAccepted = false
      try {
        const freshKey = newRetryKey()
        for (const event of gradeEvents) {
          const row = await claimBroadcast(db, event.id, grade, leaseMs, freshKey)
          if (row != null) claimed.push({ row, event })
        }
        // 既に全て送信済み、または別プロセスがリース中 — 二重送信を避けるため何もしない。
        if (claimed.length === 0) continue

        // review R2 blocker: retry key ごとに push をまとめる。通常は全件が
        // `freshKey` の 1 グループ（＝級ごと 1 通・AC-10）。「まとめて送ったが確定に
        // 失敗した行」を後から一部だけ再送する場合だけ、その行は当時のキーを持つので
        // 別グループになり、元の送信と同じキーで送り直される（LINE が重複排除する）。
        // キーをその場の行集合から導くと、再送で集合が変わった瞬間に別キーとなり
        // 重複排除がすり抜ける。
        const byKey = new Map<string, typeof claimed>()
        for (const item of claimed) {
          const list = byKey.get(item.row.retryKey)
          if (list) list.push(item)
          else byKey.set(item.row.retryKey, [item])
        }

        let anyGroupFailed = false
        for (const [retryKey, group] of byKey) {
          const entries: GradeBroadcastEntry[] = []
          for (const { event } of group) {
            let guidelineUrl: string | null = null
            if (event.gradeBroadcastAttachmentId != null && baseUrl != null) {
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

          const pushResult = await pushGradeText(
            fetchImpl,
            binding.channelAccessToken,
            binding.lineGroupId,
            buildGradeBroadcastMessage(entries),
            logger,
            retryKey,
          )
          if (pushResult.outcome === 'accepted') anyPushAccepted = true

          if (pushResult.outcome === 'accepted') {
            // ownership CAS: claim 取得時の claimed_at と一致する行だけ確定する。
            // リース失効で別プロセスが再 claim していたら 0 件になり、そちらの
            // 処理を壊さない。
            for (const { row } of group) {
              await db
                .update(eventGradeBroadcasts)
                .set({ sentAt: sql`now()` })
                .where(
                  and(
                    eq(eventGradeBroadcasts.id, row.id),
                    eq(eventGradeBroadcasts.claimedAt, row.claimedAt),
                  ),
                )
            }
          } else if (pushResult.outcome === 'failed') {
            // 受理されていないことが確かなので claim を取り消し、未送信のまま残す
            // （紐付けは解除しない）。後から再送できるようにする (AC-9 / AC-21)。
            // ここも ownership CAS 付きで消す。
            anyGroupFailed = true
            await deleteOwnedClaims(db, group.map((g) => g.row))
          } else {
            // outcome === 'unknown': 受理されたか不明。**claim も retry_key も消さない**。
            // リース失効後の再試行が同じキーで送るので、実は受理されていた場合は LINE が
            // 重複排除する。ここで消すと次回は新しいキーになり二重配信になる。
            anyGroupFailed = true
            logger.warn('grade broadcast push outcome unknown; keeping claim for same-key retry', {
              grade,
              httpStatus: pushResult.httpStatus,
            })
          }
        }
        if (anyGroupFailed) result.failedGrades.push(grade)
        else result.sentGrades.push(grade)
      } catch (err) {
        logger.warn('broadcastEventsToGradeGroups: grade processing failed', {
          grade,
          error: err instanceof Error ? err.message : String(err),
        })
        // push が既に受理されている場合は claim を消さない。消すと「LINE には
        // 届いたが未送信扱い」になり、次回の配信・再送で二重に届く。確定だけが
        // 失敗した claim は残しておけば、再 claim 時に**同じ retry key が返る**ので
        // LINE 側で冪等化される。
        if (!anyPushAccepted && claimed.length > 0) {
          await deleteOwnedClaims(
            db,
            claimed.map((c) => c.row),
          ).catch(() => undefined)
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
