import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  applyWebhookEvents,
  handleLineWebhook,
  verifyLineSignature,
  type LineReplyClient,
  type LineWebhookPayload,
} from './line-webhook-handler'
import {
  attachmentShareTokens,
  eventBroadcastMessages,
  eventLineBroadcasts,
  events,
  lineChannels,
  mailAttachments,
  mailMessages,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'
import { db } from './db'

const CHANNEL_SECRET = 'test-secret-abcdef'

async function resetDb() {
  // Order matters — child rows first so FK doesn't fire.
  await db.delete(eventBroadcastMessages)
  await db.delete(attachmentShareTokens)
  await db.delete(eventLineBroadcasts)
  await db.delete(lineChannels)
  await db.delete(tournamentDrafts)
  await db.delete(mailAttachments)
  await db.delete(mailMessages)
  await db.delete(events)
  await db.delete(users)
}

async function insertChannel(overrides: Partial<{
  status: 'available' | 'assigned' | 'active' | 'disabled'
  assignedEventId: number | null
  channelSecret: string
  channelAccessToken: string
  botId: string
}> = {}) {
  const inserted = await db
    .insert(lineChannels)
    .values({
      channelId: `c-${Math.random().toString(36).slice(2, 10)}`,
      channelSecret: overrides.channelSecret ?? CHANNEL_SECRET,
      channelAccessToken: overrides.channelAccessToken ?? 'token',
      botId: overrides.botId ?? '@kagetra-event-bot-test',
      purpose: 'event_broadcast',
      status: overrides.status ?? 'assigned',
      assignedEventId: overrides.assignedEventId ?? null,
    })
    .returning()
  return inserted[0]!
}

async function insertEvent(): Promise<number> {
  const rows = await db
    .insert(events)
    .values({
      title: 'テスト大会',
      eventDate: '2026-06-01',
    })
    .returning({ id: events.id })
  return rows[0]!.id
}

async function insertBroadcast(
  eventId: number,
  channelId: number,
  overrides: Partial<{
    status:
      | 'invite_pending'
      | 'joined_waiting_code'
      | 'linked'
      | 'revoked'
      | 'released'
    inviteCode: string | null
    inviteCodeExpiresAt: Date | null
    lineGroupId: string | null
  }> = {},
) {
  const inserted = await db
    .insert(eventLineBroadcasts)
    .values({
      eventId,
      lineChannelId: channelId,
      status: overrides.status ?? 'invite_pending',
      inviteCode: overrides.inviteCode ?? null,
      inviteCodeExpiresAt: overrides.inviteCodeExpiresAt ?? null,
      lineGroupId: overrides.lineGroupId ?? null,
    })
    .returning()
  return inserted[0]!
}

function signBody(body: string, secret = CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

interface CapturedReply {
  replyToken: string
  text: string
}

function makeReplyClient(): { client: LineReplyClient; captured: CapturedReply[] } {
  const captured: CapturedReply[] = []
  return {
    captured,
    client: {
      async reply({ replyToken, text }) {
        captured.push({ replyToken, text })
      },
    },
  }
}

describe('verifyLineSignature', () => {
  it('accepts a correctly-signed body', () => {
    const body = '{"hello":"world"}'
    const sig = signBody(body)
    expect(verifyLineSignature(body, sig, CHANNEL_SECRET)).toBe(true)
  })

  it('rejects missing signature', () => {
    expect(verifyLineSignature('{}', null, CHANNEL_SECRET)).toBe(false)
  })

  it('rejects different-length signature', () => {
    expect(verifyLineSignature('{}', 'short', CHANNEL_SECRET)).toBe(false)
  })

  it('rejects body tampered after signing', () => {
    const sig = signBody('{"a":1}')
    expect(verifyLineSignature('{"a":2}', sig, CHANNEL_SECRET)).toBe(false)
  })
})

describe('handleLineWebhook', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('returns 401 on invalid JSON', async () => {
    const res = await handleLineWebhook(db, 'not json', signBody('not json'))
    expect(res.status).toBe(401)
  })

  it('returns 401 on bad signature', async () => {
    const channel = await insertChannel()
    const body = JSON.stringify({ destination: channel.botId, events: [] })
    const res = await handleLineWebhook(db, body, 'wrong-sig')
    expect(res.status).toBe(401)
    expect(res.reason).toBe('bad_signature')
  })

  it('returns 404 when destination matches no channel', async () => {
    const body = JSON.stringify({ destination: '@nope', events: [] })
    const res = await handleLineWebhook(db, body, signBody(body))
    expect(res.status).toBe(404)
  })

  it('routes verified events to the handler', async () => {
    const channel = await insertChannel({ status: 'assigned' })
    const eventId = await insertEvent()
    await insertBroadcast(eventId, channel.id, { status: 'invite_pending' })

    const payload = {
      destination: channel.botId,
      events: [
        {
          type: 'join',
          replyToken: 'r-1',
          source: { type: 'group', groupId: 'C123' },
        },
      ],
    }
    const body = JSON.stringify(payload)
    const replyClient = makeReplyClient()
    const res = await handleLineWebhook(db, body, signBody(body), replyClient.client)
    expect(res.status).toBe(200)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channel.id),
    })
    expect(broadcast?.status).toBe('joined_waiting_code')
    expect(broadcast?.lineGroupId).toBe('C123')
    expect(replyClient.captured).toHaveLength(1)
    expect(replyClient.captured[0]!.text).toMatch(/招待コード/)
  })
})

describe('applyWebhookEvents — invite code path', () => {
  let channelId: number
  let eventId: number

  beforeEach(async () => {
    await resetDb()
    const channel = await insertChannel({ status: 'assigned' })
    channelId = channel.id
    eventId = await insertEvent()
  })

  it('flips broadcast to linked and channel to active on a valid code', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C123',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'r-2',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    expect(broadcast?.status).toBe('linked')
    expect(broadcast?.linkedAt).not.toBeNull()
    expect(broadcast?.inviteCode).toBeNull()

    const channel = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('active')

    expect(reply.captured).toHaveLength(1)
    expect(reply.captured[0]!.text).toMatch(/紐付けました/)
  })

  it('rejects expired codes without altering state', async () => {
    const past = new Date(Date.now() - 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: past,
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'r-3',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    expect(broadcast?.status).toBe('joined_waiting_code')
    expect(reply.captured[0]!.text).toMatch(/❌/)
  })

  it('rejects mismatched codes', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '654321',
      inviteCodeExpiresAt: future,
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          source: { type: 'group', groupId: 'C123' },
          replyToken: 'r-4',
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)
    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    expect(broadcast?.status).toBe('joined_waiting_code')
    expect(reply.captured[0]!.text).toMatch(/❌/)
  })

  it('ignores non-6-digit text without replying', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '654321',
      inviteCodeExpiresAt: future,
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          source: { type: 'group', groupId: 'C123' },
          replyToken: 'r-5',
          message: { type: 'text', text: 'hello' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)
    expect(reply.captured).toHaveLength(0)
  })
})

describe('applyWebhookEvents — leave path', () => {
  it('marks broadcast revoked and returns the channel to the pool', async () => {
    await resetDb()
    const channel = await insertChannel({ status: 'active' })
    const eventId = await insertEvent()
    await db
      .update(lineChannels)
      .set({ assignedEventId: eventId })
      .where(eq(lineChannels.id, channel.id))
    await insertBroadcast(eventId, channel.id, { status: 'linked' })

    const payload: LineWebhookPayload = {
      destination: channel.botId,
      events: [
        {
          type: 'leave',
          source: { type: 'group', groupId: 'C123' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channel.id, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channel.id),
    })
    expect(broadcast?.status).toBe('revoked')
    expect(broadcast?.revokeReason).toBe('bot_kicked')

    const after = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channel.id),
    })
    expect(after?.status).toBe('available')
    expect(after?.assignedEventId).toBeNull()
  })
})
