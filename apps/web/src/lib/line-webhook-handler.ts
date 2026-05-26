import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  eventLineBroadcasts,
  events,
  lineChannels,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { isValidInviteCodeFormat, verifyInviteCode } from '@/lib/invite-code'

/**
 * LINE webhook entry point logic, extracted from the Next.js route handler
 * so it is unit-testable without spinning up a real request.
 *
 * Scope (mirrors requirements §4.4):
 *   - Verify X-Line-Signature using the destination's channel_secret.
 *   - On `join` event: record the source group ID + mark the broadcast row
 *     as joined_waiting_code, then reply once with the operator guidance.
 *   - On `leave` / `memberLeft`: tear the binding down (status='revoked',
 *     channel returned to the pool).
 *   - On `message` text matching /^\d{6}$/: verify against any open
 *     invite_pending / joined_waiting_code broadcast for this channel.
 *     On match, flip to linked and acknowledge. On mismatch, reply with
 *     a generic invalid message (we never tell the user *why* it failed
 *     — that signal helps an attacker triangulate stale codes).
 *   - All other event types and message shapes return without side effects.
 */

export interface LineWebhookSource {
  type: 'user' | 'group' | 'room' | string
  groupId?: string
  userId?: string
  roomId?: string
}

export interface LineWebhookEvent {
  type: string
  replyToken?: string
  source: LineWebhookSource
  message?: { type: string; text?: string }
}

export interface LineWebhookPayload {
  destination: string
  events: LineWebhookEvent[]
}

export interface LineReplyClient {
  reply(args: { replyToken: string; text: string; channelAccessToken: string }): Promise<void>
}

export interface HandleWebhookOptions {
  /**
   * Override `Date.now()` for deterministic tests.
   */
  now?: Date
  /**
   * Side-channel for tests / observability — invoked with structured
   * logging tuples instead of writing to stdout.
   */
  logger?: (event: string, ctx: Record<string, unknown>) => void
}

export interface HandleWebhookResult {
  status: 200 | 401 | 404
  reason?: string
}

/**
 * Verify the LINE webhook signature.
 *
 * LINE signs the *raw* request body with HMAC-SHA256(channelSecret) and
 * sends the base64 in `X-Line-Signature`. The verification is per-channel
 * because each Bot in the broadcast pool has its own secret.
 *
 * Implementation note: `timingSafeEqual` requires equal-length buffers, so
 * we early-return on length mismatch before the comparison itself.
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64')
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

const ACTIVE_BROADCAST_STATUSES = [
  'invite_pending',
  'joined_waiting_code',
] as const

interface ChannelLookup {
  id: number
  channelSecret: string
  channelAccessToken: string
}

async function loadChannelByDestination(
  db: typeof appDb,
  destination: string,
): Promise<ChannelLookup | null> {
  // `destination` in LINE webhook payloads is the Bot's userId, which we
  // stored as `bot_id` at seed time. Some setups also use `channelId` —
  // try both to keep this resilient.
  const rows = await db
    .select({
      id: lineChannels.id,
      channelSecret: lineChannels.channelSecret,
      channelAccessToken: lineChannels.channelAccessToken,
      botId: lineChannels.botId,
      channelId: lineChannels.channelId,
    })
    .from(lineChannels)
    .where(eq(lineChannels.purpose, 'event_broadcast'))
  const hit = rows.find(
    (row) => row.botId === destination || row.channelId === destination,
  )
  return hit
    ? {
        id: hit.id,
        channelSecret: hit.channelSecret,
        channelAccessToken: hit.channelAccessToken,
      }
    : null
}

/**
 * Default `LineReplyClient` that hits LINE's reply endpoint with a raw
 * `fetch`. Lives in this module so callers can swap it in tests without
 * shimming `global.fetch`.
 */
export const defaultLineReplyClient: LineReplyClient = {
  async reply({ replyToken, text, channelAccessToken }) {
    if (process.env.LINE_NOTIFY_DRY_RUN === '1') return
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`LINE reply failed: ${res.status} ${body.slice(0, 200)}`)
    }
  },
}

const INVITE_CODE_PATTERN = /^\d{6}$/

/**
 * Apply the side effects encoded in a verified webhook payload. Returns a
 * 200 even when individual events have nothing to do — LINE retries on
 * non-200, so swallowing errors here is intentional. Per-event failures
 * are surfaced via the logger.
 */
export async function applyWebhookEvents(
  db: typeof appDb,
  channelId: number,
  channelAccessToken: string,
  payload: LineWebhookPayload,
  replyClient: LineReplyClient,
  options: HandleWebhookOptions = {},
): Promise<void> {
  const now = options.now ?? new Date()
  const log = options.logger ?? (() => undefined)

  for (const event of payload.events) {
    try {
      switch (event.type) {
        case 'join': {
          await handleJoin(db, channelId, event, channelAccessToken, replyClient)
          break
        }
        case 'leave':
        case 'memberLeft': {
          await handleLeave(db, channelId, event)
          break
        }
        case 'message': {
          if (event.message?.type === 'text' && event.message.text) {
            const text = event.message.text.trim()
            if (INVITE_CODE_PATTERN.test(text)) {
              await handleInviteCode(
                db,
                channelId,
                channelAccessToken,
                event,
                text,
                replyClient,
                now,
              )
            }
            // Non-code text and non-text messages are intentionally ignored.
          }
          break
        }
        default:
          // memberJoined, follow, etc. — surfaced for visibility but no-op.
          break
      }
    } catch (err) {
      log('webhook_event_failed', {
        channelId,
        eventType: event.type,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function handleJoin(
  db: typeof appDb,
  channelId: number,
  event: LineWebhookEvent,
  channelAccessToken: string,
  replyClient: LineReplyClient,
): Promise<void> {
  const groupId = event.source.groupId
  if (!groupId) return

  // Find the currently-open broadcast row for this channel (invite_pending).
  // If the operator regenerated the code while the Bot was being invited,
  // there may be multiple rows over time — but only one with this channel
  // and an active status is ever live (line_channels.assigned_event_id
  // UNIQUE keeps it so).
  await db
    .update(eventLineBroadcasts)
    .set({
      lineGroupId: groupId,
      status: 'joined_waiting_code',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(eventLineBroadcasts.lineChannelId, channelId),
        eq(eventLineBroadcasts.status, 'invite_pending'),
      ),
    )

  if (event.replyToken) {
    await replyClient.reply({
      replyToken: event.replyToken,
      text: 'このグループは大会連絡用 Bot です。30 分以内に管理者から提示された 6 桁の招待コードを発言してください。',
      channelAccessToken,
    })
  }
}

async function handleLeave(
  db: typeof appDb,
  channelId: number,
  _event: LineWebhookEvent,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokeReason: 'bot_kicked',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventLineBroadcasts.lineChannelId, channelId),
          sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
        ),
      )

    await tx
      .update(lineChannels)
      .set({
        status: 'available',
        assignedEventId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(lineChannels.id, channelId))
  })
}

async function handleInviteCode(
  db: typeof appDb,
  channelId: number,
  channelAccessToken: string,
  event: LineWebhookEvent,
  text: string,
  replyClient: LineReplyClient,
  now: Date,
): Promise<void> {
  if (!isValidInviteCodeFormat(text)) return

  const candidate = await db.query.eventLineBroadcasts.findFirst({
    where: and(
      eq(eventLineBroadcasts.lineChannelId, channelId),
      sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
    ),
    columns: {
      id: true,
      eventId: true,
      inviteCode: true,
      inviteCodeExpiresAt: true,
    },
  })

  const result = verifyInviteCode(
    text,
    candidate?.inviteCode ?? null,
    candidate?.inviteCodeExpiresAt ?? null,
    now,
  )

  if (!result.ok || !candidate) {
    if (event.replyToken) {
      await replyClient.reply({
        replyToken: event.replyToken,
        text: '❌ 招待コードが無効です。管理者に最新のコードを確認してください。',
        channelAccessToken,
      })
    }
    return
  }

  // Bind the channel + broadcast to the event. The group ID may already be
  // set from the prior `join` event, but we accept the late-arriving case
  // where the operator invites the Bot via UI link and never triggers the
  // explicit join (e.g. group already created).
  const groupId = event.source.groupId
  await db.transaction(async (tx) => {
    await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'linked',
        linkedAt: sql`now()`,
        lineGroupId: groupId ?? sql`${eventLineBroadcasts.lineGroupId}`,
        // Invalidate the consumed code so it can't be reused — even if the
        // partial UNIQUE allowed it, replay would be confusing in the UI.
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(eventLineBroadcasts.id, candidate.id))

    await tx
      .update(lineChannels)
      .set({ status: 'active', updatedAt: sql`now()` })
      .where(eq(lineChannels.id, channelId))
  })

  const ev = await db.query.events.findFirst({
    where: eq(events.id, candidate.eventId),
    columns: { title: true },
  })

  if (event.replyToken) {
    await replyClient.reply({
      replyToken: event.replyToken,
      text: `✅ 大会「${ev?.title ?? candidate.eventId}」と紐付けました。今後この大会宛の連絡をこのグループに自動配信します。`,
      channelAccessToken,
    })
  }
}

/**
 * Full handler: signature verification + channel lookup + event dispatch.
 * The route handler in `app/api/webhook/line/route.ts` is a thin wrapper
 * that turns the Next.js Request into the inputs this function expects.
 */
export async function handleLineWebhook(
  db: typeof appDb,
  rawBody: string,
  signature: string | null,
  replyClient: LineReplyClient = defaultLineReplyClient,
  options: HandleWebhookOptions = {},
): Promise<HandleWebhookResult> {
  let payload: LineWebhookPayload
  try {
    payload = JSON.parse(rawBody) as LineWebhookPayload
  } catch {
    return { status: 401, reason: 'invalid_json' }
  }

  if (typeof payload.destination !== 'string' || !Array.isArray(payload.events)) {
    return { status: 401, reason: 'malformed_payload' }
  }

  const channel = await loadChannelByDestination(db, payload.destination)
  if (!channel) {
    // Unknown destination — could be a system-notify Bot routed here by
    // mistake, or a stale config. 404 keeps the response distinguishable
    // from signature failures.
    return { status: 404, reason: 'unknown_destination' }
  }

  if (!verifyLineSignature(rawBody, signature, channel.channelSecret)) {
    return { status: 401, reason: 'bad_signature' }
  }

  await applyWebhookEvents(
    db,
    channel.id,
    channel.channelAccessToken,
    payload,
    replyClient,
    options,
  )
  return { status: 200 }
}
