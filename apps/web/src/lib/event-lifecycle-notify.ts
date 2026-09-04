import { and, eq, sql } from 'drizzle-orm'
import {
  eventLifecycleNotificationTypeEnum,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  events,
  lineChannels,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { formatEventDate } from '@/lib/event-date'
import {
  buildMentionMessage,
  buildTextMessage,
  type LineMessage,
  type LineOutgoingMessage,
  type MentionTarget,
} from '@/lib/line-mention'

/**
 * event-lifecycle-notify: lifecycle LINE notifications (申込/支払い完了 +
 * 締切/当日リマインド).
 *
 * This module is intentionally self-contained: it does NOT import
 * `line-broadcast.ts` (which a parallel branch, mail-body-as-image, is
 * editing). A single text push is light enough to implement here over `fetch`.
 * The push / binding-load / 401-4xx-recovery code mirrors line-broadcast.ts;
 * consolidating the two is a deliberate post-merge refactor (requirements §6.9).
 */

type Database = typeof appDb
// The transaction handle drizzle hands to `db.transaction(cb)` — extracted from
// the callback's first param so `claim`/`finalize` can run inside a caller's tx.
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

export type LifecycleNotificationType =
  (typeof eventLifecycleNotificationTypeEnum.enumValues)[number]

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}
const NOOP_LOGGER: Logger = { info: () => undefined, warn: () => undefined }

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const PUSH_TIMEOUT_MS = 30_000

/**
 * Advance-reminder lead time in days (default 3). Read at call time so tests
 * and operators can override via env without a rebuild.
 */
export function reminderLeadDays(): number {
  const raw = Number(process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS)
  return Number.isInteger(raw) && raw > 0 ? raw : 3
}

// ---------------------------------------------------------------------------
// Date / formatting helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Today's date as 'YYYY-MM-DD' in JST, independent of the server TZ. Mirrors
 * the `toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })` pattern used in
 * the events page and submitAttendance.
 */
export function jstTodayIso(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

/**
 * Add `days` to a 'YYYY-MM-DD' date string, returning 'YYYY-MM-DD'. Pure
 * calendar math in UTC so there is no TZ/DST drift (date-only, and JST has no
 * DST regardless).
 */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** Format 'YYYY-MM-DD' as 'M/D' (no leading zeros) for human-facing messages. */
export function formatMMDD(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** Format a JPY amount as e.g. "1,000円", or null when the fee is unset. */
export function formatFeeAmount(feeJpy: number | null | undefined): string | null {
  if (feeJpy == null) return null
  return `${feeJpy.toLocaleString('ja-JP')}円`
}

// ---------------------------------------------------------------------------
// Message templates (pure)
// ---------------------------------------------------------------------------

export interface LifecycleMessageContext {
  /**
   * 大会名。line-bot-message-revamp タスク5/6 で全10種別から大会名を出さなくなった
   * ため未使用（呼び出し側は互換のため空文字などを渡してよい）。
   */
  title: string
  /** Relevant date as 'YYYY-MM-DD' (entry/payment deadline, or event date). */
  dateIso?: string
  /** Lead days for `*_advance` reminders. Defaults to `reminderLeadDays()`. */
  leadDays?: number
  // entry-notify-lottery-treasurer ------------------------------------------
  /**
   * 抽選日 'YYYY-MM-DD'。entry_applied で非 null のとき空行を挟んで
   * 「抽選日はM/D(曜)です。」を追記、NULL なら「抽選日は未定です。」（§3.2.1）。
   */
  lotteryDateIso?: string | null
}

/**
 * grade-entry-fee: 級未設定で総額に未算入の人数の注記。0/未指定なら null。
 *
 * **この文言の唯一の置き場所**。管理者向け画面表示（イベント詳細の「振込総額」行）が
 * この書式を使う。`entry-fee.ts` は `formatFeeAmount` をこのファイルから import して
 * いるので、依存の向きを保つため注記の整形もこちら側に置く（逆向きに張ると循環する）。
 *
 * line-bot-message-revamp タスク5: 通知文面側の呼び出し元（旧 `buildTotalSuffix`）は
 * 全種別から金額を外したため削除した。この関数自体は画面表示側がまだ使うので残す。
 */
export function formatUnknownGradeNote(count: number | undefined): string | null {
  return count != null && count > 0 ? `※級未設定 ${count}名は未算入` : null
}

/**
 * `entry_applied_treasurer`（申込完了の2通目・会計向け）の予告文（要件 §3.2.3・
 * line-bot-message-revamp タスク6・AC-29）。
 *
 * 申込完了の時点では抽選前で当選者が決まっておらず、振り込むべき金額が確定しない
 * （会計が実際に動くのは名簿確定後）。そのため `payment_deadline` / `payment_method` /
 * `payment_info` を一切参照しない・金額を載せない・大会名を出さない・支払いタイプ
 * （事前払い／現地払い／未設定）で出し分けない・複数日でも単一日と同一の固定文面
 * （大会名を出さない以上、束ねても出し分ける材料がないため）。
 *
 * `buildLifecycleMessage` は戻り値が `string` 固定（他8種別が使う契約）なので、
 * メンション付き `LineMessage` を返すこの種別専用の関数として独立させた。
 */
export function buildTreasurerNoticeMessage(mention: MentionTarget): LineMessage {
  return buildMentionMessage({
    mention,
    label: '@会計',
    template: '振込連絡は名簿確定時に連絡します。',
  })
}

/**
 * Build the fixed-template text for a lifecycle notification.
 *
 * **2026-08-22 全面改訂（line-bot-message-revamp タスク5/6）。** 全9種別の文面を
 * requirements §3.2.1/§3.2.3 の表へ差し替えた: 宛先は1グループ＝1大会なので大会名を
 * 出さない・金額も一切出さない。日付は `formatEventDate`（曜日つき）を使う（旧
 * `formatMMDD` の曜日なし表記から変更）。複数日（`ctx.days`）を束ねても大会名を出さ
 * ない以上、単一日と文面が同一になるため、全種別が `multiDay` の出し分けを持たない
 * （束ね処理自体は `event_lifecycle_notifications` の claim/finalize 側・呼び出し元で
 * 維持する）。`entry_applied_treasurer` はメンション付き文面（`buildTreasurerNoticeMessage`）
 * が正本で、この関数の分岐は型の網羅性ガードを壊さないための素テキスト版
 * （メンション対象0件相当）を返す。
 */
export function buildLifecycleMessage(
  type: LifecycleNotificationType,
  ctx: LifecycleMessageContext,
): string {
  const date = ctx.dateIso ? formatEventDate(ctx.dateIso) : ''
  const lead = ctx.leadDays ?? reminderLeadDays()

  switch (type) {
    case 'entry_applied': {
      // §3.2.1: 大会名は出さない。抽選日が設定されていれば空行を挟んで追記、NULL なら
      // 「抽選日は未定です。」（抽選日はグループ単位で同一という運用前提のため、複数日
      // でも出し分けない＝ ctx.days は参照しない）。
      return ctx.lotteryDateIso
        ? `申し込みが完了しました！\n\n抽選日は${formatEventDate(ctx.lotteryDateIso)}です。`
        : '申し込みが完了しました！\n\n抽選日は未定です。'
    }
    case 'entry_applied_treasurer': {
      // §3.2.3・タスク6: 正本は `buildTreasurerNoticeMessage`（メンション付き textV2）。
      // ここは型の網羅性ガード用の素テキスト版（メンション対象0件相当）を返すだけ。
      return buildTreasurerNoticeMessage({ kind: 'users', userIds: [] }).text
    }
    case 'entry_deadline_advance':
      return `申込締切は${date}（あと${lead}日）です。まだ申し込みが行われていません。`
    case 'entry_deadline_day':
      return '⚠️申込は今日までです！⚠️'
    case 'payment_paid':
      return '参加費の振り込みが完了しました。'
    case 'payment_deadline_advance':
      return `支払い締切は${date}（あと${lead}日）です。まだ振込が行われていません。`
    case 'payment_deadline_day':
      return '⚠️振込締切は今日までです！⚠️'
    case 'onsite_payment_advance':
      return '参加費は現地払いです。当日忘れないようにしてください。'
    case 'onsite_payment_day':
      return '大会当日です！参加費を忘れないようにしてください。'
    default: {
      // Exhaustiveness guard: adding an enum value without a branch is a compile error.
      const _exhaustive: never = type
      throw new Error(`Unknown lifecycle notification type: ${String(_exhaustive)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// LINE push (self-contained, single text message)
// ---------------------------------------------------------------------------

export interface LinkedEventBinding {
  broadcastId: number
  // entry-groups タスク3: リカバリで line_channels.assigned_entry_group_id を
  // 正しく解放するために保持する。
  entryGroupId: number
  lineChannelId: number
  lineGroupId: string
  channelAccessToken: string
}

/**
 * Load the live (`status='linked'`, group present) broadcast binding for an
 * event, joined with its channel access token. Returns null when the event has
 * no linked LINE group — the common case, in which lifecycle pushes are skipped.
 *
 * entry-groups タスク3: 帰属は event_line_broadcasts.entry_group_id に移った。
 * シグネチャは eventId のまま維持し、内部で events.entry_group_id を引いて
 * グループ基準の行を返す（AC-4: どの日から呼んでも同一の紐付けに作用する）。
 */
export async function loadLinkedBinding(
  dbc: DbOrTx,
  eventId: number,
): Promise<LinkedEventBinding | null> {
  // ★グループ解決と binding 取得は1文の JOIN（r3 review blocker）。2文に分けると、
  // 間にイベントが別グループへ付け替えられた場合に旧グループの LINE グループへ
  // 通知してしまう。line-broadcast.ts の `loadActiveBinding` と同じ形に揃える。
  const rows = await dbc
    .select({
      broadcastId: eventLineBroadcasts.id,
      entryGroupId: eventLineBroadcasts.entryGroupId,
      lineChannelId: eventLineBroadcasts.lineChannelId,
      lineGroupId: eventLineBroadcasts.lineGroupId,
      channelAccessToken: lineChannels.channelAccessToken,
    })
    .from(events)
    .innerJoin(eventLineBroadcasts, eq(eventLineBroadcasts.entryGroupId, events.entryGroupId))
    .innerJoin(lineChannels, eq(lineChannels.id, eventLineBroadcasts.lineChannelId))
    .where(and(eq(events.id, eventId), eq(eventLineBroadcasts.status, 'linked')))
    .limit(1)
  const hit = rows[0]
  if (!hit || !hit.lineGroupId) return null
  return {
    broadcastId: hit.broadcastId,
    entryGroupId: hit.entryGroupId,
    lineChannelId: hit.lineChannelId,
    lineGroupId: hit.lineGroupId,
    channelAccessToken: hit.channelAccessToken,
  }
}

/**
 * グループ単位の binding ローダー（line-bot-message-revamp §3.3.4）。
 * `loadLinkedBinding` の JOIN から events を外しただけの変種で、条件は同じ
 * （`status='linked'` かつ `line_group_id` あり）。
 */
export async function loadLinkedBindingForGroup(
  dbc: DbOrTx,
  entryGroupId: number,
): Promise<LinkedEventBinding | null> {
  const rows = await dbc
    .select({
      broadcastId: eventLineBroadcasts.id,
      entryGroupId: eventLineBroadcasts.entryGroupId,
      lineChannelId: eventLineBroadcasts.lineChannelId,
      lineGroupId: eventLineBroadcasts.lineGroupId,
      channelAccessToken: lineChannels.channelAccessToken,
    })
    .from(eventLineBroadcasts)
    .innerJoin(lineChannels, eq(lineChannels.id, eventLineBroadcasts.lineChannelId))
    .where(
      and(
        eq(eventLineBroadcasts.entryGroupId, entryGroupId),
        eq(eventLineBroadcasts.status, 'linked'),
      ),
    )
    .limit(1)
  const hit = rows[0]
  if (!hit || !hit.lineGroupId) return null
  return {
    broadcastId: hit.broadcastId,
    entryGroupId: hit.entryGroupId,
    lineChannelId: hit.lineChannelId,
    lineGroupId: hit.lineGroupId,
    channelAccessToken: hit.channelAccessToken,
  }
}

interface SinglePushResult {
  ok: boolean
  httpStatus: number | null
  error: Error | null
}

/**
 * Push messages to a LINE group over `fetch`. Honors `LINE_NOTIFY_DRY_RUN=1`
 * (skips the API and reports success) and bounds the request with a 30s
 * AbortController timeout, matching line-broadcast.ts.
 *
 * line-bot-message-revamp: 引数が**メッセージオブジェクトの配列**なのは、会計向け
 * 通知と振込連絡が `textV2`（メンション付き）になり、振込連絡は2通に分かれるため
 * （要件 §3.2.2）。push は1リクエスト最大5通まで。
 */
async function pushMessages(
  channelAccessToken: string,
  to: string,
  messages: readonly LineOutgoingMessage[],
  logger: Logger,
): Promise<SinglePushResult> {
  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping lifecycle push', { to })
    return { ok: true, httpStatus: null, error: null }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS)
  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, messages }),
      signal: controller.signal,
    })
    if (res.ok) return { ok: true, httpStatus: res.status, error: null }
    const body = await res.text().catch(() => '')
    return {
      ok: false,
      httpStatus: res.status,
      error: new Error(`LINE push failed: ${res.status} ${body.slice(0, 200)}`),
    }
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
    return {
      ok: false,
      httpStatus: null,
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

/**
 * On a push failure, mirror line-broadcast.ts recovery (requirements §3.2.5):
 *   - 401 (token expired/invalid): disable the channel + revoke the binding.
 *   - 403 / 404 (Bot kicked / group gone): revoke the binding and return the
 *     channel to the pool.
 * Both are guarded on the original (channel, group) so a binding that was
 * re-linked since send-time is never clobbered. 429 / 5xx / transport errors
 * are left alone (best-effort; the date condition expires next day, §3.2.3).
 *
 * ★**400 では紐付けを解除しない**（line-bot-message-revamp のレビュー指摘）。
 * かつては 429 以外の 4xx をすべて「宛先が無効」とみなして revoke していたが、
 * textV2（メンション付き）を導入したことで**メッセージ内容起因の 400**
 * （メンション超過・文字数超過など）が起こりうるようになった。宛先とは無関係な
 * ペイロード不正で正常な紐付けを壊すと、その大会の通知が以後すべて止まる。
 * 400 は送信失敗として記録するだけに留め、宛先の無効を明確に示す 403 / 404 だけを
 * 解除対象にする。
 */
async function applyPushFailureRecovery(
  dbc: Database,
  binding: LinkedEventBinding,
  eventId: number | null,
  httpStatus: number | null,
  logger: Logger,
): Promise<void> {
  const isAuthFailure = httpStatus === 401
  // 宛先の無効を明確に示すものだけ（400 = ペイロード不正は対象外）。
  const isDestinationGone = httpStatus === 403 || httpStatus === 404
  if (!isAuthFailure && !isDestinationGone) return

  await dbc.transaction(async (tx) => {
    const revoked = await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokeReason: isAuthFailure ? 'channel_disabled' : 'line_api_4xx',
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventLineBroadcasts.id, binding.broadcastId),
          eq(eventLineBroadcasts.status, 'linked'),
          eq(eventLineBroadcasts.lineChannelId, binding.lineChannelId),
          eq(eventLineBroadcasts.lineGroupId, binding.lineGroupId),
        ),
      )
      .returning({ id: eventLineBroadcasts.id })

    if (revoked.length === 0) {
      logger.warn('lifecycle push recovery skipped (binding changed)', {
        eventId,
        originalChannelId: binding.lineChannelId,
        httpStatus,
      })
      return
    }

    // 401 → channel is dead (disabled); 403/404 → channel is fine, return to pool.
    await tx
      .update(lineChannels)
      .set({
        status: isAuthFailure ? 'disabled' : 'available',
        assignedEntryGroupId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(lineChannels.id, binding.lineChannelId),
          eq(lineChannels.assignedEntryGroupId, binding.entryGroupId),
        ),
      )
  })

  logger.warn(
    isAuthFailure
      ? 'LINE channel disabled + binding revoked due to 401 (lifecycle)'
      : 'LINE binding revoked due to 403/404 (lifecycle)',
    { eventId, channelId: binding.lineChannelId, httpStatus },
  )
}

export interface PushTextResult {
  outcome: 'sent' | 'failed' | 'skipped'
  reason?: string
  httpStatus?: number | null
  lineGroupId?: string | null
}

/**
 * Push messages to the LINE group bound to an event. Returns 'skipped' when the
 * event has no linked group (no push, not an error). On API failure, records
 * the failure and runs the 401/403/404 recovery before returning 'failed'.
 */
export async function pushMessagesToEventGroup(
  dbc: Database,
  eventId: number,
  messages: readonly LineOutgoingMessage[],
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const binding = await loadLinkedBinding(dbc, eventId)
  return pushToBinding(dbc, binding, eventId, messages, opts)
}

/** 従来の「1通のテキストを送る」経路。ライフサイクル通知8種はこちらのまま。 */
export async function pushTextToEventGroup(
  dbc: Database,
  eventId: number,
  text: string,
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  return pushMessagesToEventGroup(dbc, eventId, [buildTextMessage(text)], opts)
}

/**
 * line-bot-message-revamp §3.3.4: **申込グループ単位**で push する（振込連絡）。
 *
 * 紐付け（`event_line_broadcasts`）は元からグループ帰属なので、代表イベントを
 * 経由せず直接引く。`entry_group_payment_notices` がグループ単位のキーを持つのと
 * 揃える（代表イベントを挟むと、付け替え時にどのイベントを代表にしたかで
 * 結果が変わりうる）。
 */
export async function pushMessagesToEntryGroup(
  dbc: Database,
  entryGroupId: number,
  messages: readonly LineOutgoingMessage[],
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const binding = await loadLinkedBindingForGroup(dbc, entryGroupId)
  return pushToBinding(dbc, binding, null, messages, opts)
}

/** 解決済み binding へ push し、失敗時は 401/403/404 リカバリを回す共通部。 */
async function pushToBinding(
  dbc: Database,
  binding: LinkedEventBinding | null,
  eventId: number | null,
  messages: readonly LineOutgoingMessage[],
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const logger = opts.logger ?? NOOP_LOGGER
  if (!binding) {
    return { outcome: 'skipped', reason: 'no_linked_binding', lineGroupId: null }
  }

  const res = await pushMessages(binding.channelAccessToken, binding.lineGroupId, messages, logger)
  if (res.ok) {
    return { outcome: 'sent', httpStatus: res.httpStatus, lineGroupId: binding.lineGroupId }
  }

  logger.warn('lifecycle push failed', {
    eventId,
    entryGroupId: binding.entryGroupId,
    httpStatus: res.httpStatus,
    error: res.error?.message,
  })
  await applyPushFailureRecovery(dbc, binding, eventId, res.httpStatus, logger)
  return {
    outcome: 'failed',
    reason: res.error?.message,
    httpStatus: res.httpStatus,
    lineGroupId: binding.lineGroupId,
  }
}

// ---------------------------------------------------------------------------
// once-ever log: claim / finalize / send
// ---------------------------------------------------------------------------

export interface ClaimResult {
  claimed: boolean
  id?: number
}

/**
 * Claim the once-ever slot for (eventId, type) via INSERT ... ON CONFLICT DO
 * NOTHING. A returned row means we won the claim and should send. Accepts a
 * transaction handle so the completion path can claim atomically with the
 * status flip; a cron re-run (reminder path) is suppressed by the UNIQUE.
 *
 * The row is claimed as status='skipped' (a placeholder meaning "not yet
 * sent"); call `finalizeLifecycleNotification` after the push.
 */
export async function claimLifecycleNotification(
  dbc: DbOrTx,
  eventId: number,
  type: LifecycleNotificationType,
): Promise<ClaimResult> {
  const inserted = await dbc
    .insert(eventLifecycleNotifications)
    .values({ eventId, type, status: 'skipped' })
    .onConflictDoNothing({
      target: [eventLifecycleNotifications.eventId, eventLifecycleNotifications.type],
    })
    .returning({ id: eventLifecycleNotifications.id })
  return inserted[0] ? { claimed: true, id: inserted[0].id } : { claimed: false }
}

/** Update a claimed log row's send outcome (status + audit fields). */
export async function finalizeLifecycleNotification(
  dbc: DbOrTx,
  id: number,
  fields: {
    status: 'sent' | 'failed' | 'skipped'
    lineGroupId?: string | null
    errorMessage?: string | null
  },
): Promise<void> {
  await dbc
    .update(eventLifecycleNotifications)
    .set({
      status: fields.status,
      lineGroupId: fields.lineGroupId ?? null,
      errorMessage: fields.errorMessage ?? null,
    })
    .where(eq(eventLifecycleNotifications.id, id))
}

/** 文字列で渡された文面を `type:'text'` 1通に正規化する（既存呼び出しの互換）。 */
function toMessages(
  message: string | readonly LineOutgoingMessage[],
): readonly LineOutgoingMessage[] {
  return typeof message === 'string' ? [buildTextMessage(message)] : message
}

/**
 * Given an already-claimed log row, push the text to the event's group and
 * finalize the row's status. Shared by the completion path (after the
 * state-change tx commits) and the reminder batch.
 */
export async function sendClaimedNotification(
  dbc: Database,
  args: { notificationId: number; eventId: number; message: string | readonly LineOutgoingMessage[] },
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const result = await pushMessagesToEventGroup(dbc, args.eventId, toMessages(args.message), opts)
  await finalizeLifecycleNotification(dbc, args.notificationId, {
    status: result.outcome,
    lineGroupId: result.lineGroupId ?? null,
    errorMessage: result.outcome === 'failed' ? (result.reason ?? null) : null,
  })
  return result
}

/**
 * entry-groups タスク4: 一括操作用。複数の claim 済みログ行を、1回の push の結果で
 * まとめて finalize する（1通のメッセージを N 件の (event,type) claim に対応付ける）。
 * `eventId` は push 先の LINE グループを解決するための代表イベント（グループ内の
 * どの日でも同じ紐付けに解決されるので、呼び出し側は claim できた集合の先頭など
 * 任意の1件を渡せばよい）。
 */
export async function sendClaimedNotificationBulk(
  dbc: Database,
  args: {
    notificationIds: readonly number[]
    eventId: number
    message: string | readonly LineOutgoingMessage[]
  },
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const result = await pushMessagesToEventGroup(dbc, args.eventId, toMessages(args.message), opts)
  await Promise.all(
    args.notificationIds.map((id) =>
      finalizeLifecycleNotification(dbc, id, {
        status: result.outcome,
        lineGroupId: result.lineGroupId ?? null,
        errorMessage: result.outcome === 'failed' ? (result.reason ?? null) : null,
      }),
    ),
  )
  return result
}

/**
 * Reminder path (daily batch): claim the once-ever slot, then push + finalize
 * in one call. No surrounding transaction — the claim is its own statement, so
 * a cron re-run hits the UNIQUE and returns 'skipped' (reason 'already_notified').
 */
export async function sendReminderNotification(
  dbc: Database,
  args: {
    eventId: number
    type: LifecycleNotificationType
    message: string | readonly LineOutgoingMessage[]
  },
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const claim = await claimLifecycleNotification(dbc, args.eventId, args.type)
  if (!claim.claimed || claim.id == null) {
    return { outcome: 'skipped', reason: 'already_notified' }
  }
  return sendClaimedNotification(
    dbc,
    { notificationId: claim.id, eventId: args.eventId, message: args.message },
    opts,
  )
}
