import { and, eq, sql } from 'drizzle-orm'
import {
  eventLifecycleNotificationTypeEnum,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

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
  title: string
  /** Participation fee in JPY; null/undefined omits the amount from the text. */
  feeJpy?: number | null
  /** Relevant date as 'YYYY-MM-DD' (entry/payment deadline, or event date). */
  dateIso?: string
  /** Lead days for `*_advance` reminders. Defaults to `reminderLeadDays()`. */
  leadDays?: number
}

/**
 * Build the fixed-template text for a lifecycle notification. Prefixes per
 * requirements §3.2.1 (✅ 完了 / ⏰ 事前 / ⚠️ 当日 / 💰 現地払い). When `feeJpy`
 * is null the amount is dropped from payment messages (§3.2.4).
 */
export function buildLifecycleMessage(
  type: LifecycleNotificationType,
  ctx: LifecycleMessageContext,
): string {
  const { title } = ctx
  const date = ctx.dateIso ? formatMMDD(ctx.dateIso) : ''
  const lead = ctx.leadDays ?? reminderLeadDays()
  const fee = formatFeeAmount(ctx.feeJpy)

  switch (type) {
    case 'entry_applied':
      return `✅【${title}】への参加申込が完了しました。`
    case 'entry_deadline_advance':
      return `⏰【${title}】の申込締切は ${date}（あと ${lead} 日）です。まだ申込が完了していません。`
    case 'entry_deadline_day':
      return `⚠️【${title}】の申込締切は本日 ${date} です。まだ申込が完了していません。`
    case 'payment_paid':
      return fee
        ? `✅【${title}】の参加費（${fee}）の支払いが完了しました。`
        : `✅【${title}】の参加費の支払いが完了しました。`
    case 'payment_deadline_advance':
      return `⏰【${title}】の参加費の支払締切は ${date}（あと ${lead} 日）です。まだ支払いが完了していません。`
    case 'payment_deadline_day':
      return `⚠️【${title}】の参加費の支払締切は本日 ${date} です。まだ支払いが完了していません。`
    case 'onsite_payment_advance':
      return fee
        ? `💰【${title}】は当日現地払いです。参加費 ${fee} を ${date} 当日お持ちください。`
        : `💰【${title}】は当日現地払いです。参加費を ${date} 当日お持ちください。`
    case 'onsite_payment_day':
      return fee
        ? `💰 本日は【${title}】です。現地払い ${fee} をお忘れなく。`
        : `💰 本日は【${title}】です。参加費の現地払いをお忘れなく。`
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
  lineChannelId: number
  lineGroupId: string
  channelAccessToken: string
}

/**
 * Load the live (`status='linked'`, group present) broadcast binding for an
 * event, joined with its channel access token. Returns null when the event has
 * no linked LINE group — the common case, in which lifecycle pushes are skipped.
 */
export async function loadLinkedBinding(
  dbc: DbOrTx,
  eventId: number,
): Promise<LinkedEventBinding | null> {
  const rows = await dbc
    .select({
      broadcastId: eventLineBroadcasts.id,
      lineChannelId: eventLineBroadcasts.lineChannelId,
      lineGroupId: eventLineBroadcasts.lineGroupId,
      channelAccessToken: lineChannels.channelAccessToken,
    })
    .from(eventLineBroadcasts)
    .innerJoin(lineChannels, eq(lineChannels.id, eventLineBroadcasts.lineChannelId))
    .where(
      and(
        eq(eventLineBroadcasts.eventId, eventId),
        eq(eventLineBroadcasts.status, 'linked'),
      ),
    )
    .limit(1)
  const hit = rows[0]
  if (!hit || !hit.lineGroupId) return null
  return {
    broadcastId: hit.broadcastId,
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
 * Push a single text message to a LINE group over `fetch`. Honors
 * `LINE_NOTIFY_DRY_RUN=1` (skips the API and reports success) and bounds the
 * request with a 30s AbortController timeout, matching line-broadcast.ts.
 */
async function pushSingleText(
  channelAccessToken: string,
  to: string,
  text: string,
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
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
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
 *   - other 4xx (≠429; groupId invalid / Bot kicked): revoke the binding and
 *     return the channel to the pool.
 * Both are guarded on the original (channel, group) so a binding that was
 * re-linked since send-time is never clobbered. 429 / 5xx / transport errors
 * are left alone (best-effort; the date condition expires next day, §3.2.3).
 */
async function applyPushFailureRecovery(
  dbc: Database,
  binding: LinkedEventBinding,
  eventId: number,
  httpStatus: number | null,
  logger: Logger,
): Promise<void> {
  const isAuthFailure = httpStatus === 401
  const isOtherClientError =
    httpStatus != null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429
  if (!isAuthFailure && !isOtherClientError) return

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

    // 401 → channel is dead (disabled); other 4xx → channel is fine, return to pool.
    await tx
      .update(lineChannels)
      .set({
        status: isAuthFailure ? 'disabled' : 'available',
        assignedEventId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(lineChannels.id, binding.lineChannelId),
          eq(lineChannels.assignedEventId, eventId),
        ),
      )
  })

  logger.warn(
    isAuthFailure
      ? 'LINE channel disabled + binding revoked due to 401 (lifecycle)'
      : 'LINE binding revoked due to 4xx (lifecycle)',
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
 * Push one text to the LINE group bound to an event. Returns 'skipped' when the
 * event has no linked group (no push, not an error). On API failure, records
 * the failure and runs the 401/4xx recovery before returning 'failed'.
 */
export async function pushTextToEventGroup(
  dbc: Database,
  eventId: number,
  text: string,
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const logger = opts.logger ?? NOOP_LOGGER
  const binding = await loadLinkedBinding(dbc, eventId)
  if (!binding) {
    return { outcome: 'skipped', reason: 'no_linked_binding', lineGroupId: null }
  }

  const res = await pushSingleText(binding.channelAccessToken, binding.lineGroupId, text, logger)
  if (res.ok) {
    return { outcome: 'sent', httpStatus: res.httpStatus, lineGroupId: binding.lineGroupId }
  }

  logger.warn('lifecycle push failed', {
    eventId,
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

/**
 * Given an already-claimed log row, push the text to the event's group and
 * finalize the row's status. Shared by the completion path (after the
 * state-change tx commits) and the reminder batch.
 */
export async function sendClaimedNotification(
  dbc: Database,
  args: { notificationId: number; eventId: number; message: string },
  opts: { logger?: Logger } = {},
): Promise<PushTextResult> {
  const result = await pushTextToEventGroup(dbc, args.eventId, args.message, opts)
  await finalizeLifecycleNotification(dbc, args.notificationId, {
    status: result.outcome,
    lineGroupId: result.lineGroupId ?? null,
    errorMessage: result.outcome === 'failed' ? (result.reason ?? null) : null,
  })
  return result
}

/**
 * Reminder path (daily batch): claim the once-ever slot, then push + finalize
 * in one call. No surrounding transaction — the claim is its own statement, so
 * a cron re-run hits the UNIQUE and returns 'skipped' (reason 'already_notified').
 */
export async function sendReminderNotification(
  dbc: Database,
  args: { eventId: number; type: LifecycleNotificationType; message: string },
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
