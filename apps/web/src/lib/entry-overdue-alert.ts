import { and, asc, desc, eq, gte, ne, sql } from 'drizzle-orm'
import { events, eventAttendances, lineChannels } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { diffDays } from '@/lib/jst-date'
import { formatMMDD, jstTodayIso } from '@/lib/event-lifecycle-notify'
import { deriveEntryGroupName, selectRepresentativeEvent } from '@/lib/entry-groups'
import { formatEventDate } from '@/lib/event-date'

/**
 * entry-overdue-alert: 会内締切超過の未申込大会を管理者個人 LINE (system_notify
 * チャネル) へ毎日サマリ通知する。
 *
 * requirements.md §3.2.1 / §3.2.3 の失敗ポリシー順序（①抽出→②チャネル解決→
 * ③PUBLIC_BASE_URL 解決→④文面→⑤push）に従い、`sendEntryOverdueAlert` がこの順で
 * 束ねる。`event_lifecycle_notifications`（once-ever ログ表）は一切参照しない
 * （AC-10）— 毎日繰り返し送るのが要件そのもので、once-ever は真逆の保証だからだ。
 *
 * event-lifecycle-notify.ts と同じく `fetch` で直接 LINE push する自己完結実装
 * （line-broadcast-guidelines.ts の「重依存を避けるため意図的に import しない」
 * 方針を踏襲）。日付ヘルパーは重複定義せず、'YYYY-MM-DD' の今日取得・MM/DD 整形は
 * event-lifecycle-notify.ts から、日数差分計算は既存の汎用ユーティリティ
 * jst-date.ts の `diffDays` から import する。
 *
 * entry-groups タスク5 (AC-13): サマリーは `entry_group_id` 単位で1行に集約する
 * （`groupOverdueRows`）。表示名・代表イベント選定は entry-groups.ts の
 * `deriveEntryGroupName` / `selectRepresentativeEvent` を再利用する。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（event-lifecycle-notify.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}
const NOOP_LOGGER: Logger = { info: () => undefined, warn: () => undefined }

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const PUSH_TIMEOUT_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 3
const TOP_LIMIT = 5
const TITLE_MAX_CODEPOINTS = 30

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// ① 対象抽出 (pure I/O, no line_channels / event_line_broadcasts joins)
// ---------------------------------------------------------------------------

export interface OverdueEntryRow {
  eventId: number
  /** entry-groups タスク5 (AC-13): グループ単位への集約キー。 */
  entryGroupId: number
  title: string
  /** 'YYYY-MM-DD'。tie-break の安定ソート用。 */
  eventDate: string
  /** COALESCE(internal_deadline, entry_deadline) の値。 */
  baseDeadlineIso: string
  /** 基準締切が会内締切そのものか、entry_deadline 代替かを表す。 */
  baseDeadlineSource: 'internal' | 'entry'
  entryDeadlineIso: string | null
  /** today - baseDeadlineIso（日数）。抽出条件により常に正。 */
  overdueDays: number
  /** event_attendances.attend = true の件数。 */
  attendCount: number
}

/**
 * 要件 §3.2.1 の 4 条件 + 参加希望者 1 名以上で対象 events 行を抽出する。
 * `event_line_broadcasts` へは一切 JOIN しない（AC-5: LINE グループの紐付け
 * 有無に依存させない）。
 *
 * entry-management（§3.2.9）で 5 つ目の条件 `attendCount >= 1` を追加した。
 * 申込管理ボード `/admin/entries` が「会内締切を過ぎて参加希望者が 0 名」の
 * 大会を非表示にするため、同じ大会を LINE が「申込漏れ」と鳴らし続けると
 * 画面と通知の定義が食い違い、管理者がどちらも信用しなくなる。既存 4 条件
 * （cancelled 除外 / 開催日未来 / not_applied / 基準締切超過）は変えない。
 *
 * SQL 側にも決定的な ORDER BY を付ける（Postgres の行順は保証されないため）。
 * 表示用のソート・tie-break は `buildOverdueAlertMessage` が純関数として担う。
 */
export async function collectOverdueEntries(
  dbc: DbOrTx,
  opts: { today: string },
): Promise<OverdueEntryRow[]> {
  const { today } = opts
  const baseDeadlineExpr = sql`coalesce(${events.internalDeadline}, ${events.entryDeadline})`

  // event_attendances.id との名前衝突を避けるため alias `ea` を明示する。埋め込んだ
  // ${events.id} は event_attendances 側の id 列と同名衝突し、テーブル修飾子なしの
  // "id" に潰れて誤って自己相関する（実測で発覚。events 側は raw text "events.id"
  // で外側クエリのテーブル名を直接参照して曖昧さを断つ）。
  const attendCountExpr = sql<number>`(
    select count(*)::int
    from ${eventAttendances} ea
    where ea.event_id = events.id
      and ea.attend = true
  )`

  const rows = await dbc
    .select({
      eventId: events.id,
      entryGroupId: events.entryGroupId,
      title: events.title,
      eventDate: events.eventDate,
      internalDeadline: events.internalDeadline,
      entryDeadline: events.entryDeadline,
      attendCount: attendCountExpr,
    })
    .from(events)
    .where(
      and(
        ne(events.status, 'cancelled'),
        gte(events.eventDate, today),
        eq(events.entryStatus, 'not_applied'),
        sql`${baseDeadlineExpr} is not null`,
        sql`${baseDeadlineExpr} < ${today}`,
        // entry-management §3.2.9: 参加希望者が 0 名の大会は申し込む理由が
        // ないので鳴らさない。SELECT と同じ相関サブクエリを WHERE でも
        // 評価する（数十行規模なので二重評価のコストは無視できる）。
        sql`${attendCountExpr} >= 1`,
      ),
    )
    .orderBy(sql`${baseDeadlineExpr} asc`, asc(events.eventDate), asc(events.id))

  return rows.map((row) => {
    const baseDeadlineSource: 'internal' | 'entry' = row.internalDeadline ? 'internal' : 'entry'
    // where 句で非 NULL を保証しているので non-null アサーションで問題ない。
    const baseDeadlineIso = (row.internalDeadline ?? row.entryDeadline) as string
    return {
      eventId: row.eventId,
      entryGroupId: row.entryGroupId,
      title: row.title,
      eventDate: row.eventDate,
      baseDeadlineIso,
      baseDeadlineSource,
      entryDeadlineIso: row.entryDeadline,
      overdueDays: diffDays(baseDeadlineIso, today),
      attendCount: row.attendCount,
    }
  })
}

// ---------------------------------------------------------------------------
// ③ 絶対 URL の origin 解決
// ---------------------------------------------------------------------------

/**
 * サマリー各行に載せる大会詳細 URL の origin を解決する。未設定だけでなく
 * 形式も検証する — `new.hokudaicarta.com` のような裸のホストを通すと、LINE 上で
 * タップできないただの文字列が届いてしまう（AC-8 が要求するのは絶対 URL）。
 * line-broadcast.ts の `resolveBaseUrl` と同方針（重依存を避けるため import は
 * せず、同じ規則を各モジュールで明示する）。
 */
function resolveBaseUrl(override?: string): string {
  const candidate = override ?? process.env.PUBLIC_BASE_URL
  if (!candidate) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured. entry-overdue-alert requires an absolute URL for LINE links.',
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
// ④ 文面組立 (pure)
// ---------------------------------------------------------------------------

/** LINE の 1 行が極端に長くならないよう、コードポイント単位で切り詰める（§3.2.3）。 */
function truncateLine(input: string, max: number): string {
  const codepoints = Array.from(input)
  if (codepoints.length <= max) return input
  return codepoints.slice(0, max).join('') + '…'
}

function formatBaseDeadlineLine(row: OverdueEntryRow): string {
  const label =
    row.baseDeadlineSource === 'internal' ? '会内締切' : '会内締切（大会申込締切で代替）'
  return `${label} ${formatMMDD(row.baseDeadlineIso)}（${row.overdueDays}日超過）`
}

function formatEntryDeadlineLine(row: OverdueEntryRow, today: string): string {
  if (!row.entryDeadlineIso) return '大会申込締切 未設定'
  const remaining = diffDays(today, row.entryDeadlineIso)
  if (remaining > 0) return `大会申込締切 ${formatMMDD(row.entryDeadlineIso)}（あと${remaining}日）`
  if (remaining === 0) return `大会申込締切 ${formatMMDD(row.entryDeadlineIso)}（本日締切）`
  return `大会申込締切 ${formatMMDD(row.entryDeadlineIso)}（${-remaining}日超過）`
}

export interface BuildOverdueAlertMessageOptions {
  today: string
  baseUrl: string
}

/**
 * entry-groups タスク5 (AC-13): グループ単位に集約した1行分のサマリー。
 * `rows` は開催日昇順（同日は eventId 昇順）に安定ソート済みの構成日
 * （超過報告の対象になった日のみ — グループ内の非対象日は含まない）。
 */
interface OverdueGroupSummary {
  entryGroupId: number
  /** 導出表示名（導出不能なら代表イベントのタイトルへフォールバック）。 */
  name: string
  /** 代表イベント（今日以降で最も近い開催日、無ければ最新）の id。詳細 URL に使う。 */
  representativeEventId: number
  /** グループ内の対象日のうち最大の超過日数。グループの並び替えキー。 */
  maxOverdueDays: number
  /** event_attendances.attend=true の最大値（同一会員の複数日出席を合算しない）。 */
  attendCount: number
  rows: OverdueEntryRow[]
}

/**
 * 純関数。`rows`（超過報告対象の日）を `entryGroupId` でグルーピングする。
 * 表示名・代表イベントの選定は entry-groups.ts の導出ロジック
 * （`deriveEntryGroupName` / `selectRepresentativeEvent`）を再利用する
 * ── ここではロジックを複製しない。
 *
 * 代表イベントはこの関数に渡された「対象日」の中からのみ選ぶ
 * （グループ内の非対象日はここに現れないので選定候補にできない）。
 * そのため表示名がグループ全体（例: 多摩CDE）ではなく報告対象日だけ
 * （例: 多摩C）から導出されることがある — 対象外の日を隠さないよう、
 * 呼び出し側で構成日を列挙する（`buildOverdueAlertMessage` 参照）。
 */
function groupOverdueRows(
  rows: readonly OverdueEntryRow[],
  today: string,
): OverdueGroupSummary[] {
  const byGroup = new Map<number, OverdueEntryRow[]>()
  const order: number[] = []
  for (const row of rows) {
    const existing = byGroup.get(row.entryGroupId)
    if (existing) {
      existing.push(row)
    } else {
      byGroup.set(row.entryGroupId, [row])
      order.push(row.entryGroupId)
    }
  }

  return order.map((entryGroupId) => {
    const groupRows = [...byGroup.get(entryGroupId)!].sort(
      (a, b) => a.eventDate.localeCompare(b.eventDate) || a.eventId - b.eventId,
    )
    const rep = selectRepresentativeEvent(
      groupRows.map((r) => ({ id: r.eventId, eventDate: r.eventDate })),
      today,
    )
    // groupRows は必ず 1 件以上あるので selectRepresentativeEvent は null を返さない。
    const representativeEventId = rep!.id
    const name =
      deriveEntryGroupName(groupRows.map((r) => r.title)) ??
      groupRows.find((r) => r.eventId === representativeEventId)!.title
    const maxOverdueDays = Math.max(...groupRows.map((r) => r.overdueDays))
    // 参加人数は「延べ」ではなく最大値 — 同一会員が複数日に参加希望すると
    // 合計では二重に数えてしまう。
    const attendCount = Math.max(...groupRows.map((r) => r.attendCount))
    return { entryGroupId, name, representativeEventId, maxOverdueDays, attendCount, rows: groupRows }
  })
}

/**
 * 純関数。グループ単位に集約し（AC-13）、超過日数降順（tie-break: グループ内最速の
 * eventDate 昇順→eventId 昇順の安定ソート）で並べ、上位 5 グループを明細、残りを
 * 「他 N 件」に畳む（buildNewDraftsMessage と同じ形式）。`rows` は呼び出し側から
 * 任意の順序で渡されうる前提で、ここで並び替えを完結する。
 *
 * グループ内に対象日が複数あるときは、日別ラベル（`M/D(曜)+タイトル`）を明細の先頭に
 * 挟んで、どの日の締切超過かを明示する（単独グループでは従来どおり省略し、
 * 既存の1行1大会の文面とバイト互換を保つ）。
 */
export function buildOverdueAlertMessage(
  rows: OverdueEntryRow[],
  opts: BuildOverdueAlertMessageOptions,
): string {
  const { today } = opts
  // PUBLIC_BASE_URL に末尾スラッシュが入りうるため、連結前に必ず落とす。
  const baseUrl = opts.baseUrl.replace(/\/$/, '')

  const groups = groupOverdueRows(rows, today)
  const sorted = [...groups].sort((a, b) => {
    if (b.maxOverdueDays !== a.maxOverdueDays) return b.maxOverdueDays - a.maxOverdueDays
    const aFirst = a.rows[0]!
    const bFirst = b.rows[0]!
    if (aFirst.eventDate !== bFirst.eventDate) return aFirst.eventDate < bFirst.eventDate ? -1 : 1
    return aFirst.eventId - bFirst.eventId
  })

  const head = sorted.slice(0, TOP_LIMIT)
  const lines: string[] = [`⚠️ 会内締切超過の未申込大会が${sorted.length}件あります`]

  for (const group of head) {
    lines.push('')
    lines.push(`・${truncateLine(group.name, TITLE_MAX_CODEPOINTS)}`)
    for (const row of group.rows) {
      if (group.rows.length > 1) {
        lines.push(`${formatEventDate(row.eventDate)}${row.title}`)
      }
      lines.push(formatBaseDeadlineLine(row))
      lines.push(formatEntryDeadlineLine(row, today))
    }
    lines.push(`参加 ${group.attendCount}名`)
    lines.push(`${baseUrl}/events/${group.representativeEventId}`)
  }

  if (sorted.length > head.length) {
    lines.push('')
    lines.push(`他 ${sorted.length - head.length}件`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// ② system_notify チャネル解決 (throw しない — AC-11)
// ---------------------------------------------------------------------------

export interface SystemChannel {
  channelAccessToken: string
  botId: string
  notificationLineUserId: string | null
}

/**
 * `line_channels` の `status='system'` 行を取得する。mail-worker の
 * `getSystemChannel` と違い、行が無いときは throw せず null を返す
 * （呼び出し側 `sendEntryOverdueAlert` が「未設定なら警告してスキップ・exit 0」
 * を PUBLIC_BASE_URL 解決より先に行うため。throw させると呼び出し側で
 * try/catch が要り、失敗ポリシーの順序保証が崩れる）。複数行あれば
 * `updatedAt` 最新を採用し警告する。
 */
export async function loadSystemChannel(
  dbc: DbOrTx,
  logger: Logger = NOOP_LOGGER,
): Promise<SystemChannel | null> {
  const rows = await dbc
    .select({
      channelAccessToken: lineChannels.channelAccessToken,
      botId: lineChannels.botId,
      notificationLineUserId: lineChannels.notificationLineUserId,
    })
    .from(lineChannels)
    .where(eq(lineChannels.status, 'system'))
    .orderBy(desc(lineChannels.updatedAt))

  if (rows.length === 0) return null
  if (rows.length > 1) {
    logger.warn('multiple line_channels with status=system found; using most recently updated', {
      count: rows.length,
    })
  }
  return rows[0]!
}

// ---------------------------------------------------------------------------
// ⑤ push (self-contained, single text message)
// ---------------------------------------------------------------------------

export interface PushableSystemChannel {
  channelAccessToken: string
  notificationLineUserId: string
}

interface PushOnceResult {
  ok: boolean
  httpStatus: number | null
  retryAfterSec: number | null
  error: Error | null
}

async function pushOnce(
  fetchImpl: typeof fetch,
  channelAccessToken: string,
  to: string,
  text: string,
): Promise<PushOnceResult> {
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
    if (res.ok) return { ok: true, httpStatus: res.status, retryAfterSec: null, error: null }

    const retryAfterRaw = res.status === 429 ? Number(res.headers.get('retry-after')) : NaN
    const body = await res.text().catch(() => '')
    return {
      ok: false,
      httpStatus: res.status,
      retryAfterSec: Number.isFinite(retryAfterRaw) ? retryAfterRaw : null,
      error: new Error(`LINE push failed: ${res.status} ${body.slice(0, 200)}`),
    }
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
    return {
      ok: false,
      httpStatus: null,
      retryAfterSec: null,
      error: isAbort
        ? new Error('LINE push timed out after 30s')
        : err instanceof Error
          ? err
          : new Error(String(err)),
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface PushSystemTextResult {
  outcome: 'sent' | 'failed'
  httpStatus?: number | null
  reason?: string
}

export interface PushSystemTextOptions {
  logger?: Logger
  /** テスト用に fetch を差し替える。既定はグローバル fetch（line-broadcast-guidelines.ts と同方針）。 */
  fetchImpl?: typeof fetch
}

/**
 * system_notify チャネルの管理者 userId 宛にテキスト 1 通を push する。
 * `LINE_NOTIFY_DRY_RUN=1` を尊重し、30 秒タイムアウト、429 は Retry-After に
 * 従い最大 3 回までリトライする（event-lifecycle-notify.ts の pushSingleText /
 * line-broadcast-guidelines.ts の 429 リトライを縮小して踏襲）。401/4xx の
 * チャネル無効化リカバリは持ち込まない（system チャネルはプールではないため）。
 * 失敗はリトライせず（429 を除く）ログに残すのみ — throw しない。
 */
export async function pushSystemText(
  channel: PushableSystemChannel,
  text: string,
  opts: PushSystemTextOptions = {},
): Promise<PushSystemTextResult> {
  const logger = opts.logger ?? NOOP_LOGGER
  const fetchImpl = opts.fetchImpl ?? fetch

  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping entry-overdue-alert push', {
      to: channel.notificationLineUserId,
      preview: text.slice(0, 200),
    })
    return { outcome: 'sent' }
  }

  let attempt = 0
  for (;;) {
    const result = await pushOnce(
      fetchImpl,
      channel.channelAccessToken,
      channel.notificationLineUserId,
      text,
    )
    if (result.ok) {
      return { outcome: 'sent', httpStatus: result.httpStatus }
    }
    if (result.httpStatus === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const waitMs =
        result.retryAfterSec != null && result.retryAfterSec > 0
          ? Math.min(result.retryAfterSec, 60) * 1000
          : 5000
      logger.warn('entry-overdue-alert push 429, retrying after Retry-After', {
        attempt: attempt + 1,
        waitMs,
      })
      await sleep(waitMs)
      attempt++
      continue
    }
    logger.warn('entry-overdue-alert push failed', {
      httpStatus: result.httpStatus,
      error: result.error?.message,
    })
    return { outcome: 'failed', httpStatus: result.httpStatus, reason: result.error?.message }
  }
}

// ---------------------------------------------------------------------------
// 束ね (失敗ポリシーの適用順序を固定する。requirements §3.2.3)
// ---------------------------------------------------------------------------

export type SendEntryOverdueAlertResult =
  | { skipped: 'no-candidates' | 'no-channel' | 'no-user-id' }
  | { sent: true; candidateCount: number; pushOutcome: 'sent' | 'failed' }

export interface SendEntryOverdueAlertOptions {
  /** 'YYYY-MM-DD'。既定は jstTodayIso()。 */
  today?: string
  /** 既定は process.env.PUBLIC_BASE_URL。 */
  baseUrl?: string
  logger?: Logger
  /** テスト用に fetch を差し替える（pushSystemText へそのまま渡す）。 */
  fetchImpl?: typeof fetch
}

/**
 * ①抽出 → 0 件なら push せず終了 → ②チャネル解決（未設定/userId 未設定は
 * throw せず警告してスキップ）→ ③PUBLIC_BASE_URL 解決（未設定は throw）→
 * ④文面 → ⑤push、の順に束ねる。②を③より前に置くのが要件（system_notify を
 * 構成していない環境で毎朝 exit 1 を出さないため）。
 *
 * `event_lifecycle_notifications` への INSERT/claim は一切行わない（AC-10）。
 */
export async function sendEntryOverdueAlert(
  dbc: Database,
  opts: SendEntryOverdueAlertOptions = {},
): Promise<SendEntryOverdueAlertResult> {
  const logger = opts.logger ?? NOOP_LOGGER
  const today = opts.today ?? jstTodayIso()

  // ① 対象抽出
  const rows = await collectOverdueEntries(dbc, { today })
  if (rows.length === 0) {
    return { skipped: 'no-candidates' }
  }

  // ② system_notify チャネル解決（throw しない）
  const channel = await loadSystemChannel(dbc, logger)
  if (!channel) {
    logger.warn(
      'entry-overdue-alert: no line_channels row with status=system found; skipping send',
      {},
    )
    return { skipped: 'no-channel' }
  }
  if (!channel.notificationLineUserId) {
    logger.warn(
      'entry-overdue-alert: system_notify channel is missing notification_line_user_id; skipping send',
      { botId: channel.botId },
    )
    return { skipped: 'no-user-id' }
  }

  // ③ PUBLIC_BASE_URL 解決（未設定・不正形式は throw）
  const baseUrl = resolveBaseUrl(opts.baseUrl)

  // ④ 文面組立
  const text = buildOverdueAlertMessage(rows, { today, baseUrl })

  // ⑤ push
  const pushResult = await pushSystemText(
    {
      channelAccessToken: channel.channelAccessToken,
      notificationLineUserId: channel.notificationLineUserId,
    },
    text,
    { logger, fetchImpl: opts.fetchImpl },
  )

  return { sent: true, candidateCount: rows.length, pushOutcome: pushResult.outcome }
}
