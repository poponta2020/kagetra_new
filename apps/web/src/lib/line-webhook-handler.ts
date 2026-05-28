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
  // LINE Messaging API webhooks send `destination` as the Bot's USER ID
  // (the `U` + 32-hex value), which is distinct from the Basic ID
  // (`@kagetra-event-bot-N`) stored in `bot_id`. We persist the user ID
  // separately in `webhook_destination_id` and route on it. The botId /
  // channelId fallbacks are kept for backwards compatibility with rows
  // seeded before this column existed (e.g. mid-rollout test fixtures);
  // a fresh production seed always populates webhookDestinationId.
  const rows = await db
    .select({
      id: lineChannels.id,
      channelSecret: lineChannels.channelSecret,
      channelAccessToken: lineChannels.channelAccessToken,
      botId: lineChannels.botId,
      channelId: lineChannels.channelId,
      webhookDestinationId: lineChannels.webhookDestinationId,
    })
    .from(lineChannels)
    .where(eq(lineChannels.purpose, 'event_broadcast'))
  const hit = rows.find((row) => {
    if (row.webhookDestinationId === destination) return true
    // Backward-compat fallback: only fires when webhookDestinationId is
    // NULL on the row (i.e. legacy seed). Once the operator re-runs the
    // seed script with the user ID populated, this branch becomes dead.
    if (row.webhookDestinationId == null) {
      return row.botId === destination || row.channelId === destination
    }
    return false
  })
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
        case 'leave': {
          // Bot 自身がグループから外された場合に発火する LINE 仕様。
          // `memberLeft` は通常メンバーの退出でも届くため別物として扱い、
          // ここでは処理しない (r2 review blocker)。
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
  event: LineWebhookEvent,
): Promise<void> {
  // rr1 review blocker: 同じ Bot が誤って別グループに招待されて出た場合、
  // 現在の大会グループの紐付けを壊さない。leave の source.groupId と
  // event_line_broadcasts.line_group_id が一致するときだけ revoke する。
  // groupId が無い leave (LINE 仕様上ほぼ無いが) は no-op + 警告ログ。
  const sourceGroupId = event.source?.groupId
  if (!sourceGroupId) {
    return
  }

  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokeReason: 'bot_kicked',
        // 招待コードを残すと partial unique が後続発行を塞ぐので null 化
        // (review r1 should_fix)。
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventLineBroadcasts.lineChannelId, channelId),
          eq(eventLineBroadcasts.lineGroupId, sourceGroupId),
          sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
        ),
      )
      .returning({ id: eventLineBroadcasts.id })

    // 該当する active 行が無ければ channel もそのまま (別グループからの
    // 退出など、現在の紐付けには関係ない leave)。
    if (revoked.length === 0) return

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
      lineGroupId: true,
    },
  })

  const result = verifyInviteCode(
    text,
    candidate?.inviteCode ?? null,
    candidate?.inviteCodeExpiresAt ?? null,
    now,
  )

  const sourceGroupId = event.source?.groupId

  // rr4 review blocker: 招待コードはグループ紐付け用なので、user/room
  // (= groupId が無い source) からの redeem は拒否する。これを許すと
  // event_line_broadcasts.lineGroupId が null のまま linked になり、
  // 配信時に no_active_binding でスキップされるのに channel は active
  // のままプールから失われる。
  const groupIdMissing = !sourceGroupId

  // rr3 review blocker: 招待コードを別グループ (Bot が漏れて加入した
  // 別グループ、誤転送先 etc.) で redeem されないように、stored
  // lineGroupId が既にある場合は source.groupId と一致するときだけ
  // 受け付ける。null (= join 前 / lineGroupId 未確定) のときだけ初回セット。
  const storedGroupId = candidate?.lineGroupId ?? null
  const groupMismatch =
    storedGroupId != null && storedGroupId !== sourceGroupId

  if (!result.ok || !candidate || groupIdMissing || groupMismatch) {
    if (event.replyToken) {
      await replyClient.reply({
        replyToken: event.replyToken,
        text: '❌ 招待コードが無効です。管理者に最新のコードを確認してください。',
        channelAccessToken,
      })
    }
    return
  }

  // Bind the channel + broadcast to the event. lineGroupId は stored 値が
  // あればそれを尊重、無ければ source.groupId で初回セット。
  // groupIdMissing ガードを通過しているので sourceGroupId は string 確定。
  //
  // r-final-4 blocker: candidate 取得から UPDATE までは tx 外なので、
  // 管理者の revoke / reissue が同時に走ったり、複数コード発言が同じ
  // candidate を狙うレースが起こり得る。UPDATE WHERE に「事前検証時と
  // 同じ状態」を再掲して、stale な実行は RETURNING 0 件で弾く。
  let appliedSuccessfully = false
  try {
    await db.transaction(async (tx) => {
      const broadcastUpdate = await tx
        .update(eventLineBroadcasts)
        .set({
          status: 'linked',
          linkedAt: sql`now()`,
          lineGroupId: storedGroupId ?? sourceGroupId,
          // Invalidate the consumed code so it can't be reused — even if the
          // partial UNIQUE allowed it, replay would be confusing in the UI.
          inviteCode: null,
          inviteCodeExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(eventLineBroadcasts.id, candidate.id),
            sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
            eq(eventLineBroadcasts.inviteCode, text),
            sql`${eventLineBroadcasts.inviteCodeExpiresAt} > now()`,
            // lineGroupId は (a) NULL = まだ join 未確定 or (b) source と
            // 完全一致 のどちらかでなければ拒否。実行中に別グループから
            // 紐付けが進んでいたら整合性を保つ。
            sql`(${eventLineBroadcasts.lineGroupId} IS NULL OR ${eventLineBroadcasts.lineGroupId} = ${sourceGroupId})`,
          ),
        )
        .returning({ id: eventLineBroadcasts.id })

      if (broadcastUpdate.length === 0) {
        throw new Error('STALE_BROADCAST')
      }

      // r-final-1 blocker: assignedEventId を必ず再セット。
      // r-final-4 blocker: channel が別 event に再割当済みでないこと、
      // pool に戻っていない (disabled でない) ことを WHERE で再確認。
      const channelUpdate = await tx
        .update(lineChannels)
        .set({
          status: 'active',
          assignedEventId: candidate.eventId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lineChannels.id, channelId),
            sql`${lineChannels.status} IN ('available','assigned','active')`,
            sql`(${lineChannels.assignedEventId} IS NULL OR ${lineChannels.assignedEventId} = ${candidate.eventId})`,
          ),
        )
        .returning({ id: lineChannels.id })

      if (channelUpdate.length === 0) {
        throw new Error('STALE_CHANNEL')
      }

      appliedSuccessfully = true
    })
  } catch (err) {
    // Stale 検出時は無効リプライを返してロールバック (tx 全体が revert)
    if (
      err instanceof Error &&
      (err.message === 'STALE_BROADCAST' || err.message === 'STALE_CHANNEL')
    ) {
      if (event.replyToken) {
        await replyClient.reply({
          replyToken: event.replyToken,
          text: '❌ 招待コードが無効です。管理者に最新のコードを確認してください。',
          channelAccessToken,
        })
      }
      return
    }
    throw err
  }

  if (!appliedSuccessfully) return

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
