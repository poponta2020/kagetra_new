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
  lineGradeGroupBindings,
  mailAttachments,
  mailMessages,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'
import { db } from './db'

// broadcast-guidelines-on-link: handleInviteCode が紐付け成立後に要綱送信
// ヘルパーを呼ぶ配線を検証する。実 push はここでは対象外なのでスパイに差し替える
// (既存テストは呼ばれても no-op で影響なし)。
type GuidelineResult = {
  status: 'skipped' | 'sent' | 'partial' | 'failed'
  reason?: string
  sentCount: number
  totalCount: number
}
const { sendGuidelinesOnLinkSpy } = vi.hoisted(() => ({
  sendGuidelinesOnLinkSpy: vi.fn(
    async (): Promise<GuidelineResult> => ({
      status: 'skipped',
      sentCount: 0,
      totalCount: 0,
    }),
  ),
}))
vi.mock('@/lib/line-broadcast-guidelines', () => ({
  sendGuidelinesOnLink: sendGuidelinesOnLinkSpy,
}))

const CHANNEL_SECRET = 'test-secret-abcdef'

async function resetDb() {
  // Order matters — child rows first so FK doesn't fire.
  // event-grade-group-broadcast: line_grade_group_bindings は
  // line_channels を ON DELETE RESTRICT で参照するので、lineChannels の
  // 削除より前に消す (無いと次の resetDb() で FK 違反が起きて既存の
  // event_broadcast 系テストまで巻き込んで壊れる)。
  await db.delete(eventBroadcastMessages)
  await db.delete(attachmentShareTokens)
  await db.delete(eventLineBroadcasts)
  await db.delete(lineGradeGroupBindings)
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
  webhookDestinationId: string | null
  purpose: 'event_broadcast' | 'grade_broadcast'
}> = {}) {
  const inserted = await db
    .insert(lineChannels)
    .values({
      channelId: `c-${Math.random().toString(36).slice(2, 10)}`,
      channelSecret: overrides.channelSecret ?? CHANNEL_SECRET,
      channelAccessToken: overrides.channelAccessToken ?? 'token',
      botId: overrides.botId ?? '@kagetra-event-bot-test',
      // Tests default to a deterministic user-id-shaped value so the
      // destination-routing path is exercised, not the legacy fallback.
      webhookDestinationId:
        overrides.webhookDestinationId === undefined
          ? `U${Math.random().toString(36).slice(2, 10).padEnd(32, '0')}`
          : overrides.webhookDestinationId,
      purpose: overrides.purpose ?? 'event_broadcast',
      status: overrides.status ?? 'assigned',
      assignedEventId: overrides.assignedEventId ?? null,
    })
    .returning()
  return inserted[0]!
}

async function insertGradeBinding(
  channelId: number,
  overrides: Partial<{
    grade: 'A' | 'B' | 'C' | 'D' | 'E'
    status: 'invite_pending' | 'joined_waiting_code' | 'linked' | 'revoked'
    inviteCode: string | null
    inviteCodeExpiresAt: Date | null
    lineGroupId: string | null
  }> = {},
) {
  const inserted = await db
    .insert(lineGradeGroupBindings)
    .values({
      grade: overrides.grade ?? 'A',
      lineChannelId: channelId,
      status: overrides.status ?? 'invite_pending',
      inviteCode: overrides.inviteCode ?? null,
      inviteCodeExpiresAt: overrides.inviteCodeExpiresAt ?? null,
      lineGroupId: overrides.lineGroupId ?? null,
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
    const body = JSON.stringify({
      destination: channel.webhookDestinationId,
      events: [],
    })
    const res = await handleLineWebhook(db, body, 'wrong-sig')
    expect(res.status).toBe(401)
    expect(res.reason).toBe('bad_signature')
  })

  it('returns 404 when destination matches no channel', async () => {
    const body = JSON.stringify({ destination: 'Uno-such-bot', events: [] })
    const res = await handleLineWebhook(db, body, signBody(body))
    expect(res.status).toBe(404)
  })

  it('routes verified events to the handler via webhookDestinationId', async () => {
    const channel = await insertChannel({ status: 'assigned' })
    const eventId = await insertEvent()
    await insertBroadcast(eventId, channel.id, { status: 'invite_pending' })

    const payload = {
      destination: channel.webhookDestinationId,
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

  it('falls back to botId when webhookDestinationId is NULL (legacy row)', async () => {
    const channel = await insertChannel({
      status: 'assigned',
      webhookDestinationId: null,
      botId: '@legacy-bot',
    })
    const eventId = await insertEvent()
    await insertBroadcast(eventId, channel.id, { status: 'invite_pending' })

    const body = JSON.stringify({
      destination: '@legacy-bot',
      events: [],
    })
    const res = await handleLineWebhook(db, body, signBody(body))
    expect(res.status).toBe(200)
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

  it('rejects redeem from a user/room source (no groupId)', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'invite_pending',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      // join 前なので lineGroupId は null。それでも group ではない
      // source (DM 等) からの redeem は受け付けない。
      lineGroupId: null,
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'r-dm',
          source: { type: 'user', userId: 'Uxxxxxxx' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    expect(broadcast?.status).toBe('invite_pending')
    expect(broadcast?.lineGroupId).toBeNull()
    expect(reply.captured[0]?.text).toMatch(/❌/)
  })

  it('rejects redeem from a different group than the one Bot joined', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C-joined-group',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'r-other',
          source: { type: 'group', groupId: 'C-other-group' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    // stored lineGroupId は変わらず、status も上がらない。
    expect(broadcast?.status).toBe('joined_waiting_code')
    expect(broadcast?.lineGroupId).toBe('C-joined-group')
    expect(reply.captured[0]?.text).toMatch(/❌/)
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
  it('marks broadcast revoked, clears invite code, and returns the channel to the pool', async () => {
    await resetDb()
    const channel = await insertChannel({ status: 'active' })
    const eventId = await insertEvent()
    await db
      .update(lineChannels)
      .set({ assignedEventId: eventId })
      .where(eq(lineChannels.id, channel.id))
    // Leave a stale invite code on the row so we can prove handleLeave
    // clears it — partial unique would otherwise block the next reissue.
    // lineGroupId は payload.source.groupId と一致する必要がある
    // (rr1 review blocker: 別グループの leave を取り違えないため)。
    await insertBroadcast(eventId, channel.id, {
      status: 'linked',
      inviteCode: '987654',
      inviteCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      lineGroupId: 'C123',
    })

    const payload: LineWebhookPayload = {
      destination: channel.webhookDestinationId ?? channel.botId,
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
    expect(broadcast?.inviteCode).toBeNull()
    expect(broadcast?.inviteCodeExpiresAt).toBeNull()

    const after = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channel.id),
    })
    expect(after?.status).toBe('available')
    expect(after?.assignedEventId).toBeNull()
  })

  it('ignores leave from an unrelated group (different groupId)', async () => {
    await resetDb()
    const channel = await insertChannel({ status: 'active' })
    const eventId = await insertEvent()
    await db
      .update(lineChannels)
      .set({ assignedEventId: eventId })
      .where(eq(lineChannels.id, channel.id))
    await insertBroadcast(eventId, channel.id, {
      status: 'linked',
      lineGroupId: 'C-current-group',
    })

    const payload: LineWebhookPayload = {
      destination: channel.webhookDestinationId ?? channel.botId,
      events: [
        {
          type: 'leave',
          // 違うグループから出た event。現在の紐付けには影響させない。
          source: { type: 'group', groupId: 'C-other-group' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channel.id, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channel.id),
    })
    expect(broadcast?.status).toBe('linked')
    expect(broadcast?.lineGroupId).toBe('C-current-group')

    const after = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channel.id),
    })
    expect(after?.status).toBe('active')
    expect(after?.assignedEventId).toBe(eventId)
  })
})

describe('applyWebhookEvents — 紐付け成立時の要綱送信 (broadcast-guidelines-on-link)', () => {
  let channelId: number
  let eventId: number

  beforeEach(async () => {
    await resetDb()
    sendGuidelinesOnLinkSpy.mockClear()
    sendGuidelinesOnLinkSpy.mockResolvedValue({
      status: 'skipped',
      sentCount: 0,
      totalCount: 0,
    })
    const channel = await insertChannel({ status: 'assigned' })
    channelId = channel.id
    eventId = await insertEvent()
  })

  function codePayload(): LineWebhookPayload {
    return {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'r-guide',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
  }

  it('linked 成立後に要綱送信ヘルパーを連携情報付きで呼ぶ (AC-3)', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    const broadcast = await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C123',
    })

    await applyWebhookEvents(
      db,
      channelId,
      'access-token-abc',
      codePayload(),
      makeReplyClient().client,
    )

    expect(sendGuidelinesOnLinkSpy).toHaveBeenCalledTimes(1)
    expect(sendGuidelinesOnLinkSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventLineBroadcastId: broadcast.id,
        lineGroupId: 'C123',
        channelAccessToken: 'access-token-abc',
      }),
      expect.anything(),
    )
  })

  it('無効なコード（紐付け失敗）では要綱送信を呼ばない (AC-5)', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '654321',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C123',
    })

    await applyWebhookEvents(
      db,
      channelId,
      'token',
      codePayload(),
      makeReplyClient().client,
    )

    expect(sendGuidelinesOnLinkSpy).not.toHaveBeenCalled()
  })

  it('要綱送信が失敗しても linked は保たれる (AC-6)', async () => {
    sendGuidelinesOnLinkSpy.mockResolvedValueOnce({
      status: 'failed',
      sentCount: 0,
      totalCount: 1,
    })
    const future = new Date(Date.now() + 10 * 60 * 1000)
    const broadcast = await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C123',
    })

    await applyWebhookEvents(
      db,
      channelId,
      'token',
      codePayload(),
      makeReplyClient().client,
    )

    const row = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.id, broadcast.id),
    })
    expect(row?.status).toBe('linked')
  })

  it('ヘルパーが throw しても linked は tx の外なので巻き戻らない (AC-6)', async () => {
    sendGuidelinesOnLinkSpy.mockRejectedValueOnce(new Error('boom'))
    const future = new Date(Date.now() + 10 * 60 * 1000)
    const broadcast = await insertBroadcast(eventId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C123',
    })

    // applyWebhookEvents はイベント単位の try/catch で throw を飲む（handler は 200）。
    await applyWebhookEvents(
      db,
      channelId,
      'token',
      codePayload(),
      makeReplyClient().client,
    )

    const row = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.id, broadcast.id),
    })
    expect(row?.status).toBe('linked')
  })
})

// event-grade-group-broadcast タスク3: webhook の級グループ対応。
// purpose='grade_broadcast' のチャネルを line_grade_group_bindings 経由で
// 処理する専用フローと、既存の event_broadcast フローが排他であることを検証する。
describe('grade_broadcast チャネル宛の webhook（級グループ紐付け）', () => {
  beforeEach(async () => {
    await resetDb()
    // 大会用フローの describe が同じ spy を呼ぶため、クリアしないと
    // 「級グループ経路では要綱送信を呼ばない」の assertion が前の describe の
    // 呼び出しを拾って落ちる。しかも記録済み引数に drizzle の db インスタンスが
    // 含まれるので、失敗時のシリアライズが `Invalid string length` で 26 秒かかる。
    sendGuidelinesOnLinkSpy.mockClear()
  })

  it('join でグループIDが記録され joined_waiting_code になる (AC-17, handleLineWebhook 経由でルーティングも検証)', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast' })
    await insertGradeBinding(channel.id, { grade: 'B', status: 'invite_pending' })

    const payload = {
      destination: channel.webhookDestinationId,
      events: [
        {
          type: 'join',
          replyToken: 'g-join-1',
          source: { type: 'group', groupId: 'G-grade-b' },
        },
      ],
    }
    const body = JSON.stringify(payload)
    const replyClient = makeReplyClient()
    const res = await handleLineWebhook(db, body, signBody(body), replyClient.client)
    expect(res.status).toBe(200)

    const binding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, channel.id),
    })
    expect(binding?.status).toBe('joined_waiting_code')
    expect(binding?.lineGroupId).toBe('G-grade-b')
    expect(replyClient.captured).toHaveLength(1)
    expect(replyClient.captured[0]!.text).toMatch(/招待コード/)
  })

  it('6桁コードで linked になり、line_channels / event_line_broadcasts には触れない (AC-18)', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast', status: 'assigned' })
    const future = new Date(Date.now() + 10 * 60 * 1000)
    const binding = await insertGradeBinding(channel.id, {
      grade: 'C',
      status: 'joined_waiting_code',
      inviteCode: '112233',
      inviteCodeExpiresAt: future,
      lineGroupId: 'G-grade-c',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'g-code-1',
          source: { type: 'group', groupId: 'G-grade-c' },
          message: { type: 'text', text: '112233' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(
      db,
      channel.id,
      'token',
      payload,
      reply.client,
      {},
      'grade_broadcast',
    )

    const updated = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.id, binding.id),
    })
    expect(updated?.status).toBe('linked')
    expect(updated?.linkedAt).not.toBeNull()
    expect(updated?.inviteCode).toBeNull()
    expect(updated?.inviteCodeExpiresAt).toBeNull()
    expect(updated?.lineGroupId).toBe('G-grade-c')

    // 大会用フローと違い line_channels は一切変更しない (常設チャネル)。
    const channelAfter = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channel.id),
    })
    expect(channelAfter?.status).toBe('assigned')
    expect(channelAfter?.assignedEventId).toBeNull()

    expect(reply.captured).toHaveLength(1)
    expect(reply.captured[0]!.text).toMatch(/C級グループと紐付けました/)

    // 要綱送信 (event 専用) は呼ばれない。
    expect(sendGuidelinesOnLinkSpy).not.toHaveBeenCalled()
  })

  it('期限切れコードは拒否され状態が変わらない', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast' })
    const past = new Date(Date.now() - 60 * 1000)
    await insertGradeBinding(channel.id, {
      grade: 'D',
      status: 'joined_waiting_code',
      inviteCode: '445566',
      inviteCodeExpiresAt: past,
      lineGroupId: 'G-grade-d',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'g-code-2',
          source: { type: 'group', groupId: 'G-grade-d' },
          message: { type: 'text', text: '445566' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(
      db,
      channel.id,
      'token',
      payload,
      reply.client,
      {},
      'grade_broadcast',
    )

    const binding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, channel.id),
    })
    expect(binding?.status).toBe('joined_waiting_code')
    expect(reply.captured[0]!.text).toMatch(/❌/)
  })

  it('グループ外 (user source) からの redeem を拒否する', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast' })
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertGradeBinding(channel.id, {
      grade: 'A',
      status: 'invite_pending',
      inviteCode: '778899',
      inviteCodeExpiresAt: future,
      lineGroupId: null,
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'g-code-3',
          source: { type: 'user', userId: 'Uxxxxxxx' },
          message: { type: 'text', text: '778899' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(
      db,
      channel.id,
      'token',
      payload,
      reply.client,
      {},
      'grade_broadcast',
    )

    const binding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, channel.id),
    })
    expect(binding?.status).toBe('invite_pending')
    expect(binding?.lineGroupId).toBeNull()
    expect(reply.captured[0]?.text).toMatch(/❌/)
  })

  it('join 済みグループと異なるグループからの redeem を拒否する', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast' })
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertGradeBinding(channel.id, {
      grade: 'E',
      status: 'joined_waiting_code',
      inviteCode: '990011',
      inviteCodeExpiresAt: future,
      lineGroupId: 'G-joined',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'g-code-4',
          source: { type: 'group', groupId: 'G-other' },
          message: { type: 'text', text: '990011' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(
      db,
      channel.id,
      'token',
      payload,
      reply.client,
      {},
      'grade_broadcast',
    )

    const binding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, channel.id),
    })
    expect(binding?.status).toBe('joined_waiting_code')
    expect(binding?.lineGroupId).toBe('G-joined')
    expect(reply.captured[0]?.text).toMatch(/❌/)
  })

  it('stale な CAS 条件 (status が既に linked) は 0 件更新となり無効返信を返す', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast' })
    const future = new Date(Date.now() + 10 * 60 * 1000)
    // 既に linked 済みの行は WHERE status IN ('invite_pending','joined_waiting_code')
    // に一致しないので、message ハンドラの findFirst 自体が候補を見つけられず
    // (candidate === undefined) 無効リプライになる。これは大会用フローの
    // stale CAS と同じ「候補が見つからない」経路で、同じ CAS 保護を証明する。
    await insertGradeBinding(channel.id, {
      grade: 'B',
      status: 'linked',
      inviteCode: null,
      inviteCodeExpiresAt: null,
      lineGroupId: 'G-already-linked',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'g-code-5',
          source: { type: 'group', groupId: 'G-already-linked' },
          message: { type: 'text', text: '123123' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(
      db,
      channel.id,
      'token',
      payload,
      reply.client,
      {},
      'grade_broadcast',
    )

    const binding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, channel.id),
    })
    expect(binding?.status).toBe('linked')
    expect(reply.captured[0]?.text).toMatch(/❌/)
  })

  it('leave で revoked になり、line_channels はプールへ戻らない (AC-17)', async () => {
    const channel = await insertChannel({ purpose: 'grade_broadcast', status: 'active' })
    await insertGradeBinding(channel.id, {
      grade: 'A',
      status: 'linked',
      inviteCode: '135790',
      inviteCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      lineGroupId: 'G-grade-a',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'leave',
          source: { type: 'group', groupId: 'G-grade-a' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(
      db,
      channel.id,
      'token',
      payload,
      reply.client,
      {},
      'grade_broadcast',
    )

    const binding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, channel.id),
    })
    expect(binding?.status).toBe('revoked')
    expect(binding?.revokeReason).toBe('bot_kicked')
    expect(binding?.inviteCode).toBeNull()
    expect(binding?.inviteCodeExpiresAt).toBeNull()

    // 級用チャネルは常設なので、大会用の leave と違いプールへ戻さない。
    const channelAfter = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channel.id),
    })
    expect(channelAfter?.status).toBe('active')
  })

  it('system_notify チャネル宛の destination は widening 後も 404 のまま', async () => {
    const channel = await insertChannel({ purpose: 'event_broadcast' })
    // purpose を直接 system_notify に上書き（insertChannel は event/grade しか
    // 受け付けないので生 SQL 相当の update で作る）。
    await db
      .update(lineChannels)
      .set({ purpose: 'system_notify' })
      .where(eq(lineChannels.id, channel.id))

    const body = JSON.stringify({ destination: channel.webhookDestinationId, events: [] })
    const res = await handleLineWebhook(db, body, signBody(body))
    expect(res.status).toBe(404)
  })

  it('event_broadcast チャネル宛の既存挙動は grade_broadcast チャネルが同時に存在しても変わらない（回帰）', async () => {
    // 同時に級グループチャネルを1つ用意しておき、大会用フローが誤って
    // line_grade_group_bindings 側を触らないこと・grade 側の存在に影響されない
    // ことを確認する。
    const gradeChannel = await insertChannel({ purpose: 'grade_broadcast' })
    await insertGradeBinding(gradeChannel.id, { grade: 'A', status: 'invite_pending' })

    const eventChannel = await insertChannel({ purpose: 'event_broadcast', status: 'assigned' })
    const eventId = await insertEvent()
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(eventId, eventChannel.id, {
      status: 'joined_waiting_code',
      inviteCode: '246810',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C-event',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'e-code-1',
          source: { type: 'group', groupId: 'C-event' },
          message: { type: 'text', text: '246810' },
        },
      ],
    }
    const reply = makeReplyClient()
    // purpose を明示せず（デフォルト 'event_broadcast'）呼び出し、既存の
    // 呼び出しパターンが引き続き成立することも合わせて検証する。
    await applyWebhookEvents(db, eventChannel.id, 'token', payload, reply.client)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, eventChannel.id),
    })
    expect(broadcast?.status).toBe('linked')
    expect(reply.captured[0]!.text).toMatch(/大会「.*」と紐付けました/)

    const eventChannelAfter = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, eventChannel.id),
    })
    expect(eventChannelAfter?.status).toBe('active')
    expect(eventChannelAfter?.assignedEventId).toBe(eventId)

    // grade 側の行は一切変更されていない。
    const gradeBinding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, gradeChannel.id),
    })
    expect(gradeBinding?.status).toBe('invite_pending')
    expect(gradeBinding?.lineGroupId).toBeNull()
  })
})
