import { desc, eq } from 'drizzle-orm'
import { messagingApi } from '@line/bot-sdk'
import { lineChannels } from '@kagetra/shared/schema'
import type { Db } from '../db.js'

/**
 * Thin wrapper around `@line/bot-sdk` v11 for the mail-worker's admin
 * notification path. Scope:
 *
 *   - Look up the single `status='system'` row in `line_channels` (PR5 plan
 *     Q6: provisioned via `seed-system-channel.ts`, mutated only on access
 *     token rotation).
 *   - Push a free-form text message to the configured admin LINE userId.
 *   - Hide SDK exception types behind `LineNotifyError` so the pipeline can
 *     continue (per PR5 plan note: "401 token invalid → log only, pipeline
 *     continue").
 *   - Honour `LINE_NOTIFY_DRY_RUN=1` for tests / CI / local smoke runs that
 *     should exercise the wiring without actually hitting the LINE API.
 *
 * The v11 SDK exposes `messagingApi.MessagingApiClient` whose
 * `pushMessage({ to, messages: [...] })` is the supported entry point. We
 * intentionally take the same `Db` handle the pipeline already carries
 * (Pool-backed Drizzle client) so notify is callable from inside or outside a
 * transaction without spinning a second pool.
 */

export type SystemChannel = {
  channelAccessToken: string
  botId: string
  notificationLineUserId: string | null
}

export interface NotifyLogger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

const NOOP_LOGGER: NotifyLogger = {
  info: () => undefined,
  warn: () => undefined,
}

/**
 * Thrown when no `line_channels` row with `status='system'` exists. The
 * mail-worker treats this as a fatal config error on the notify path: the
 * pipeline still completes (drafts are persisted), but the admin alert is
 * skipped and the caller logs the missing-channel state.
 */
export class LineSystemChannelNotConfiguredError extends Error {
  constructor() {
    super(
      'No line_channels row with status=system found. Seed one via apps/mail-worker/scripts/seed-system-channel.ts.',
    )
    this.name = 'LineSystemChannelNotConfiguredError'
  }
}

/**
 * Wraps any error thrown by the LINE SDK (HTTP error, network error, JSON
 * parse error). The `cause` field preserves the original error so callers /
 * tests can inspect status codes (HTTPFetchError) when needed.
 */
export class LineNotifyError extends Error {
  override readonly cause: unknown
  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'LineNotifyError'
    this.cause = cause
  }
}

export interface PushSystemNotificationResult {
  skipped: boolean
  reason?: string
}

/**
 * Fetch the `status='system'` channel row. If multiple rows exist (operator
 * mistake), pick the most recently updated one and warn — preserving the
 * latest rotation rather than blowing up.
 */
export async function getSystemChannel(
  db: Db,
  logger: NotifyLogger = NOOP_LOGGER,
): Promise<SystemChannel> {
  const rows = await db
    .select({
      channelAccessToken: lineChannels.channelAccessToken,
      botId: lineChannels.botId,
      notificationLineUserId: lineChannels.notificationLineUserId,
      updatedAt: lineChannels.updatedAt,
    })
    .from(lineChannels)
    .where(eq(lineChannels.status, 'system'))
    .orderBy(desc(lineChannels.updatedAt))

  if (rows.length === 0) {
    throw new LineSystemChannelNotConfiguredError()
  }
  if (rows.length > 1) {
    logger.warn('multiple line_channels with status=system found; using most recent', {
      count: rows.length,
    })
  }
  const row = rows[0]!
  return {
    channelAccessToken: row.channelAccessToken,
    botId: row.botId,
    notificationLineUserId: row.notificationLineUserId,
  }
}

/**
 * Push a text message to the system channel's configured admin userId.
 *
 * Returns `{ skipped: true, reason }` for the two non-error skip paths:
 *   - `no-user-id`: channel was seeded but the admin hasn't been resolved
 *     yet (LINE Login webhook not wired — that's a P3-B follow-up).
 *   - `dry-run`: `LINE_NOTIFY_DRY_RUN=1` is set; we log and skip the network
 *     call. Useful for tests, CI smoke, and local pipeline replays.
 *
 * On real failures (SDK throw) we wrap into `LineNotifyError`; the pipeline
 * caller is expected to catch and log without aborting the run.
 */
export async function pushSystemNotification(
  db: Db,
  message: string,
  logger: NotifyLogger = NOOP_LOGGER,
): Promise<PushSystemNotificationResult> {
  const channel = await getSystemChannel(db, logger)

  if (!channel.notificationLineUserId) {
    logger.warn('LINE system channel is missing notification_line_user_id; skipping push', {
      botId: channel.botId,
    })
    return { skipped: true, reason: 'no-user-id' }
  }

  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping real push', {
      to: channel.notificationLineUserId,
      preview: message.slice(0, 200),
    })
    return { skipped: true, reason: 'dry-run' }
  }

  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: channel.channelAccessToken,
  })

  try {
    await client.pushMessage({
      to: channel.notificationLineUserId,
      messages: [{ type: 'text', text: message }],
    })
    return { skipped: false }
  } catch (err) {
    throw new LineNotifyError('LINE pushMessage failed', err)
  }
}
