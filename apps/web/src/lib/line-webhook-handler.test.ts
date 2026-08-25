import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createEntryGroup,
  createEvent,
  createUser,
  createAdmin,
  createGuest,
  createEventAttendance,
} from '@/test-utils/seed'
import type { LineMessage, LineTextV2Message } from '@/lib/line-mention'
import { formatEventDate } from '@/lib/event-date'
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
  assignedEntryGroupId: number | null
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
      assignedEntryGroupId: overrides.assignedEntryGroupId ?? null,
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

/**
 * イベントを1件 seed し、その entry_group_id を返す
 * （event_line_broadcasts / line_channels の帰属先は entry_group_id なので、
 * このヘルパーの戻り値は呼び出し側でそのまま insertBroadcast / assignedEntryGroupId に渡せる）。
 */
async function insertEvent(): Promise<number> {
  const entryGroupId = (await createEntryGroup()).id
  await db.insert(events).values({
    entryGroupId,
    title: 'テスト大会',
    eventDate: '2026-06-01',
  })
  return entryGroupId
}

async function insertBroadcast(
  entryGroupId: number,
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
      entryGroupId,
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
  /** その reply リクエストに積まれた全メッセージ（reply は1回5通まで）。 */
  messages: readonly LineMessage[]
  /** 全メッセージの本文を改行で連結したもの（「どれかに含まれるか」の検証用）。 */
  text: string
}

const NEWLINE = '\n'

function makeReplyClient(): { client: LineReplyClient; captured: CapturedReply[] } {
  const captured: CapturedReply[] = []
  return {
    captured,
    client: {
      async reply({ replyToken, messages }) {
        captured.push({
          replyToken,
          messages,
          text: messages.map((m) => m.text).join(NEWLINE),
        })
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

  it('routes verified join events via webhookDestinationId and records state without replying (AC-22)', async () => {
    const channel = await insertChannel({ status: 'assigned' })
    const entryGroupId = await insertEvent()
    await insertBroadcast(entryGroupId, channel.id, { status: 'invite_pending' })

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
    // line-bot-message-revamp (AC-22): join では状態（joined_waiting_code +
    // line_group_id）だけを記録し、reply は送らない（replyToken は消費しない）。
    expect(broadcast?.status).toBe('joined_waiting_code')
    expect(broadcast?.lineGroupId).toBe('C123')
    expect(replyClient.captured).toHaveLength(0)
  })

  it('falls back to botId when webhookDestinationId is NULL (legacy row)', async () => {
    const channel = await insertChannel({
      status: 'assigned',
      webhookDestinationId: null,
      botId: '@legacy-bot',
    })
    const entryGroupId = await insertEvent()
    await insertBroadcast(entryGroupId, channel.id, { status: 'invite_pending' })

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
  let entryGroupId: number

  beforeEach(async () => {
    await resetDb()
    const channel = await insertChannel({ status: 'assigned' })
    channelId = channel.id
    entryGroupId = await insertEvent()
  })

  it('flips broadcast to linked and channel to active on a valid code, replying once with 4 messages (AC-23)', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(entryGroupId, channelId, {
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

    // A-1 廃止・A-3 を①〜④の4通に分割した紐付け成立時の案内が、1回の reply に
    // まとめて積まれる（AC-23）。
    expect(reply.captured).toHaveLength(1)
    expect(reply.captured[0]!.messages).toHaveLength(4)
  })

  it('①④: 大会名を先頭に置いた確認案内と固定の要綱案内文になる', async () => {
    // beforeEach の insertEvent() は「テスト大会」1件だけなので
    // deriveEntryGroupName がそのままタイトルを返す（フォールバック不要）。
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(entryGroupId, channelId, {
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
          replyToken: 'r-msg1',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const messages = reply.captured[0]!.messages
    expect(messages[0]).toEqual({
      type: 'text',
      text: 'テスト大会大会案内用LINEグループです！\n以下確認をお願いします。',
    })
    expect(messages[3]).toEqual({
      type: 'text',
      text: '以下大会要項になります、適宜ご確認ください',
    })
  })

  it('②: entry_deadline がある場合、textV2 で @All メンションと M/D(曜) 表記になる (AC-23)', async () => {
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      title: 'テスト大会2',
      eventDate: '2030-01-01',
      entryDeadline: '2026-09-15',
    })
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(group.id, channelId, {
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
          replyToken: 'r-msg2',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const deadlineMessage = reply.captured[0]!.messages[1]! as LineTextV2Message
    expect(deadlineMessage.type).toBe('textV2')
    expect(deadlineMessage.substitution.m0).toEqual({
      type: 'mention',
      mentionee: { type: 'all' },
    })
    expect(deadlineMessage.text).toContain(formatEventDate('2026-09-15'))
    expect(deadlineMessage.text).toContain('大会の申し込み締め切りは')
  })

  it('②: entry_deadline が NULL のときは「未定」になる (AC-25)', async () => {
    // beforeEach の insertEvent() は entry_deadline を渡さないので NULL のまま。
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(entryGroupId, channelId, {
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
          replyToken: 'r-msg2-null',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    const deadlineMessage = reply.captured[0]!.messages[1]! as LineTextV2Message
    expect(deadlineMessage.type).toBe('textV2')
    expect(deadlineMessage.text).toContain('大会の申し込み締め切りは未定です')
  })

  it('③: 参加人数はゲスト込みで〇名（内他会〇名）になり、@管理者へメンションする (AC-24)', async () => {
    const group = await createEntryGroup()
    const ev = await createEvent({
      entryGroupId: group.id,
      title: 'テスト大会3',
      eventDate: '2030-02-02',
    })
    const admin = await createAdmin({
      lineUserId: 'Uadmin00000000000000000000000000',
      lineLinkedAt: new Date(),
    })
    const member = await createUser({ isInvited: true })
    const guest = await createGuest({ isInvited: true })
    await createEventAttendance({ eventId: ev.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: guest.id, attend: true })

    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(group.id, channelId, {
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
          replyToken: 'r-msg3',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    // bug #542: ③のメンションは在籍プローブで絞られるようになったので、
    // このテストは「全員在籍」のフェイクで従来挙動（全員メンション）を検証する。
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client, {
      membershipClient: { isMember: async () => true },
    })

    const headcountMessage = reply.captured[0]!.messages[2]! as LineTextV2Message
    expect(headcountMessage.type).toBe('textV2')
    expect(headcountMessage.substitution.m0).toEqual({
      type: 'mention',
      mentionee: { type: 'user', userId: admin.lineUserId! },
    })
    expect(headcountMessage.text).toContain('景虎上の申込人数は2名（内他会1名）です')
  })

  it('③: ゲストが0名のときは括弧を省略する (AC-24)', async () => {
    const group = await createEntryGroup()
    const ev = await createEvent({
      entryGroupId: group.id,
      title: 'テスト大会4',
      eventDate: '2030-03-03',
    })
    const member = await createUser({ isInvited: true })
    await createEventAttendance({ eventId: ev.id, userId: member.id, attend: true })

    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(group.id, channelId, {
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
          replyToken: 'r-msg4',
          source: { type: 'group', groupId: 'C123' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channelId, 'token', payload, reply.client)

    // 管理者を LINE 紐付けしていないので userIds が空 → 素テキストへ倒れる
    // (buildMentionMessage の仕様。AC-5 と同じ挙動)。
    const headcountMessage = reply.captured[0]!.messages[2]!
    expect(headcountMessage.text).toContain('景虎上の申込人数は1名です')
    expect(headcountMessage.text).not.toContain('内他会')
  })

  it('rejects expired codes without altering state', async () => {
    const past = new Date(Date.now() - 60 * 1000)
    await insertBroadcast(entryGroupId, channelId, {
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
    await insertBroadcast(entryGroupId, channelId, {
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
    await insertBroadcast(entryGroupId, channelId, {
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
    await insertBroadcast(entryGroupId, channelId, {
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
    await insertBroadcast(entryGroupId, channelId, {
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
    const entryGroupId = await insertEvent()
    await db
      .update(lineChannels)
      .set({ assignedEntryGroupId: entryGroupId })
      .where(eq(lineChannels.id, channel.id))
    // Leave a stale invite code on the row so we can prove handleLeave
    // clears it — partial unique would otherwise block the next reissue.
    // lineGroupId は payload.source.groupId と一致する必要がある
    // (rr1 review blocker: 別グループの leave を取り違えないため)。
    await insertBroadcast(entryGroupId, channel.id, {
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
    expect(after?.assignedEntryGroupId).toBeNull()
  })

  it('ignores leave from an unrelated group (different groupId)', async () => {
    await resetDb()
    const channel = await insertChannel({ status: 'active' })
    const entryGroupId = await insertEvent()
    await db
      .update(lineChannels)
      .set({ assignedEntryGroupId: entryGroupId })
      .where(eq(lineChannels.id, channel.id))
    await insertBroadcast(entryGroupId, channel.id, {
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
    expect(after?.assignedEntryGroupId).toBe(entryGroupId)
  })
})

describe('applyWebhookEvents — 紐付け成立時の要綱送信 (broadcast-guidelines-on-link)', () => {
  let channelId: number
  let entryGroupId: number

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
    entryGroupId = await insertEvent()
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
    const broadcast = await insertBroadcast(entryGroupId, channelId, {
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
    await insertBroadcast(entryGroupId, channelId, {
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
    const broadcast = await insertBroadcast(entryGroupId, channelId, {
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
    const broadcast = await insertBroadcast(entryGroupId, channelId, {
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
    expect(channelAfter?.assignedEntryGroupId).toBeNull()

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

  // r2 review should_fix: 表示名が導出不能なグループでは **代表イベント**
  // （今日以降で最も近い開催日、無ければ最新）のタイトルへフォールバックする。
  // id 昇順の先頭では、作成順と開催日順が食い違うグループで他画面と別名になる。
  it('r2: 表示名が導出不能なとき、id 先頭ではなく代表イベントのタイトルを返す', async () => {
    const jstDate = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Tokyo',
      })

    const { id: entryGroupId } = await createEntryGroup()
    // 先に作る（= id が小さい）のは開催日が遠い方。共通接頭辞が無いので
    // deriveEntryGroupName は null になる。
    await db.insert(events).values({
      entryGroupId,
      title: 'ベータ大会',
      eventDate: jstDate(20),
    })
    await db.insert(events).values({
      entryGroupId,
      title: 'アルファ大会',
      eventDate: jstDate(10),
    })

    const channel = await insertChannel({ purpose: 'event_broadcast', status: 'assigned' })
    await insertBroadcast(entryGroupId, channel.id, {
      status: 'joined_waiting_code',
      inviteCode: '135791',
      inviteCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      lineGroupId: 'C-rep-name',
    })

    const payload: LineWebhookPayload = {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken: 'rep-name-1',
          source: { type: 'group', groupId: 'C-rep-name' },
          message: { type: 'text', text: '135791' },
        },
      ],
    }
    const reply = makeReplyClient()
    await applyWebhookEvents(db, channel.id, 'token', payload, reply.client)

    // 代表 = 今日以降で最も近い「アルファ大会」（id は後発で大きい）。
    expect(reply.captured[0]!.messages[0]).toEqual({
      type: 'text',
      text: 'アルファ大会大会案内用LINEグループです！\n以下確認をお願いします。',
    })
    expect(reply.captured[0]!.text).not.toContain('ベータ大会')
  })

  it('event_broadcast チャネル宛の既存挙動は grade_broadcast チャネルが同時に存在しても変わらない（回帰）', async () => {
    // 同時に級グループチャネルを1つ用意しておき、大会用フローが誤って
    // line_grade_group_bindings 側を触らないこと・grade 側の存在に影響されない
    // ことを確認する。
    const gradeChannel = await insertChannel({ purpose: 'grade_broadcast' })
    await insertGradeBinding(gradeChannel.id, { grade: 'A', status: 'invite_pending' })

    const eventChannel = await insertChannel({ purpose: 'event_broadcast', status: 'assigned' })
    const entryGroupId = await insertEvent()
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(entryGroupId, eventChannel.id, {
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
    expect(reply.captured[0]!.messages[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('大会案内用LINEグループです'),
    })

    const eventChannelAfter = await db.query.lineChannels.findFirst({
      where: eq(lineChannels.id, eventChannel.id),
    })
    expect(eventChannelAfter?.status).toBe('active')
    expect(eventChannelAfter?.assignedEntryGroupId).toBe(entryGroupId)

    // grade 側の行は一切変更されていない。
    const gradeBinding = await db.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.lineChannelId, gradeChannel.id),
    })
    expect(gradeBinding?.status).toBe('invite_pending')
    expect(gradeBinding?.lineGroupId).toBeNull()
  })
})

// bug #542: 紐付け成立案内の @管理者 個人メンションがグループ在籍を考慮せず、
// LINE が reply 全体を 400 で拒否 → 4通全滅・要綱 push 巻き添え・痕跡ゼロだった。
// - ③のメンションは在籍プローブで絞る（AC-1〜3, AC-7）
// - reply 失敗時は push フォールバック + 要綱 push は独立実行（AC-4〜5）
// - 既定 logger は console へ JSON を書く（AC-6）
describe('linked 案内の在籍プローブと送信フォールバック (bug #542)', () => {
  let channelId: number
  let webhookDestinationId: string

  beforeEach(async () => {
    await resetDb()
    sendGuidelinesOnLinkSpy.mockClear()
    const channel = await insertChannel({ status: 'assigned' })
    channelId = channel.id
    webhookDestinationId = channel.webhookDestinationId!
  })

  async function seedLinkableBroadcast(): Promise<number> {
    const entryGroupId = await insertEvent()
    const future = new Date(Date.now() + 10 * 60 * 1000)
    await insertBroadcast(entryGroupId, channelId, {
      status: 'joined_waiting_code',
      inviteCode: '123456',
      inviteCodeExpiresAt: future,
      lineGroupId: 'C542',
    })
    return entryGroupId
  }

  function codePayload(replyToken = 'r-542'): LineWebhookPayload {
    return {
      destination: '@dummy',
      events: [
        {
          type: 'message',
          replyToken,
          source: { type: 'group', groupId: 'C542' },
          message: { type: 'text', text: '123456' },
        },
      ],
    }
  }

  /** 在籍プローブのフェイク。memberIds は在籍(true)、failIds は probe 自体が throw。 */
  function makeMembershipClient(memberIds: string[], failIds: string[] = []) {
    const probed: string[] = []
    return {
      probed,
      client: {
        async isMember({ userId }: { groupId: string; userId: string; channelAccessToken: string }) {
          probed.push(userId)
          if (failIds.includes(userId)) throw new Error('probe boom')
          return memberIds.includes(userId)
        },
      },
    }
  }

  function makePushClient(shouldThrow = false) {
    const captured: Array<{ to: string; messages: readonly LineMessage[] }> = []
    return {
      captured,
      client: {
        async push({ to, messages }: { to: string; messages: readonly LineMessage[]; channelAccessToken: string }) {
          if (shouldThrow) throw new Error('push boom')
          captured.push({ to, messages })
        },
      },
    }
  }

  function makeThrowingReplyClient(): LineReplyClient {
    return {
      async reply() {
        throw new Error('LINE reply failed: 400 mention rejected')
      },
    }
  }

  it('AC-1: グループ未在籍の管理者は③のメンションから除外される', async () => {
    await seedLinkableBroadcast()
    const admin1 = await createAdmin({
      lineUserId: 'Uadmin1a000000000000000000000000',
      lineLinkedAt: new Date(),
    })
    await createAdmin({
      lineUserId: 'Uadmin2b000000000000000000000000',
      lineLinkedAt: new Date(),
    })

    const reply = makeReplyClient()
    const membership = makeMembershipClient([admin1.lineUserId!])
    await applyWebhookEvents(db, channelId, 'token', codePayload(), reply.client, {
      membershipClient: membership.client,
    })

    // 2名ともプローブされ、在籍している admin1 だけがメンションされる。
    expect(membership.probed).toHaveLength(2)
    const headcountMessage = reply.captured[0]!.messages[2]! as LineTextV2Message
    expect(headcountMessage.type).toBe('textV2')
    expect(headcountMessage.substitution).toEqual({
      m0: { type: 'mention', mentionee: { type: 'user', userId: admin1.lineUserId! } },
    })
  })

  it('AC-2: 在籍管理者が0名なら③は素テキスト（@管理者 行）で送られる', async () => {
    await seedLinkableBroadcast()
    await createAdmin({
      lineUserId: 'Uadmin1a000000000000000000000000',
      lineLinkedAt: new Date(),
    })

    const reply = makeReplyClient()
    const membership = makeMembershipClient([])
    await applyWebhookEvents(db, channelId, 'token', codePayload(), reply.client, {
      membershipClient: membership.client,
    })

    expect(reply.captured[0]!.messages).toHaveLength(4)
    const headcountMessage = reply.captured[0]!.messages[2]!
    expect(headcountMessage.type).toBe('text')
    expect(headcountMessage.text).toContain('@管理者')
    expect(headcountMessage.text).toContain('景虎上の申込人数は')
  })

  it('AC-3: プローブがエラーを返した管理者は除外され、送信は継続する', async () => {
    await seedLinkableBroadcast()
    const admin1 = await createAdmin({
      lineUserId: 'Uadmin1a000000000000000000000000',
      lineLinkedAt: new Date(),
    })
    const admin2 = await createAdmin({
      lineUserId: 'Uadmin2b000000000000000000000000',
      lineLinkedAt: new Date(),
    })

    const logged: Array<{ event: string; ctx: Record<string, unknown> }> = []
    const reply = makeReplyClient()
    const membership = makeMembershipClient([admin1.lineUserId!, admin2.lineUserId!], [admin1.lineUserId!])
    await applyWebhookEvents(db, channelId, 'token', codePayload(), reply.client, {
      membershipClient: membership.client,
      logger: (event, ctx) => logged.push({ event, ctx }),
    })

    const headcountMessage = reply.captured[0]!.messages[2]! as LineTextV2Message
    expect(headcountMessage.substitution).toEqual({
      m0: { type: 'mention', mentionee: { type: 'user', userId: admin2.lineUserId! } },
    })
    expect(logged.map((l) => l.event)).toContain('membership_probe_failed')
  })

  it('AC-7: 全員在籍なら従来どおり全員メンションされる（挙動不変）', async () => {
    await seedLinkableBroadcast()
    const admin1 = await createAdmin({
      lineUserId: 'Uadmin1a000000000000000000000000',
      lineLinkedAt: new Date(),
    })
    const admin2 = await createAdmin({
      lineUserId: 'Uadmin2b000000000000000000000000',
      lineLinkedAt: new Date(),
    })

    const reply = makeReplyClient()
    const membership = makeMembershipClient([admin1.lineUserId!, admin2.lineUserId!])
    await applyWebhookEvents(db, channelId, 'token', codePayload(), reply.client, {
      membershipClient: membership.client,
    })

    // メンション順は users.id（ランダム文字列）昇順で決まり作成順とは無関係な
    // ので、順序非依存で「2名とも含まれる」ことを検証する。
    const headcountMessage = reply.captured[0]!.messages[2]! as LineTextV2Message
    const mentionedIds = Object.values(headcountMessage.substitution).map(
      (s) => (s.mentionee as { type: 'user'; userId: string }).userId,
    )
    expect(mentionedIds).toHaveLength(2)
    expect(new Set(mentionedIds)).toEqual(new Set([admin1.lineUserId!, admin2.lineUserId!]))
  })

  it('AC-4: reply 失敗時は同一4通を push で再送し、エラーを記録し、要綱 push も実行する', async () => {
    await seedLinkableBroadcast()

    const logged: Array<{ event: string; ctx: Record<string, unknown> }> = []
    const push = makePushClient()
    await applyWebhookEvents(db, channelId, 'token', codePayload(), makeThrowingReplyClient(), {
      pushClient: push.client,
      logger: (event, ctx) => logged.push({ event, ctx }),
    })

    // linked 遷移はそのまま成立している。
    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    expect(broadcast?.status).toBe('linked')

    // reply 失敗が記録され、同一4通が同じグループへ push される。
    expect(logged.map((l) => l.event)).toContain('linked_reply_failed')
    expect(push.captured).toHaveLength(1)
    expect(push.captured[0]!.to).toBe('C542')
    expect(push.captured[0]!.messages).toHaveLength(4)
    expect(push.captured[0]!.messages[0]!.text).toContain('大会案内用LINEグループです')

    // 要綱 push は案内送信の失敗に巻き込まれず実行される。
    expect(sendGuidelinesOnLinkSpy).toHaveBeenCalledTimes(1)
  })

  it('AC-5: push フォールバックも失敗した場合、失敗を記録しつつ要綱 push は実行し webhook は 200 を返す', async () => {
    await seedLinkableBroadcast()

    const logged: Array<{ event: string; ctx: Record<string, unknown> }> = []
    const payload = { ...codePayload(), destination: webhookDestinationId }
    const body = JSON.stringify(payload)
    // handleLineWebhook 経由（本番の入口）で 200 が返ることまで確認する。
    const res = await handleLineWebhook(db, body, signBody(body), makeThrowingReplyClient(), {
      pushClient: makePushClient(true).client,
      logger: (event, ctx) => logged.push({ event, ctx }),
    })

    expect(res.status).toBe(200)
    expect(logged.map((l) => l.event)).toContain('linked_reply_failed')
    expect(logged.map((l) => l.event)).toContain('linked_push_fallback_failed')
    expect(sendGuidelinesOnLinkSpy).toHaveBeenCalledTimes(1)

    const broadcast = await db.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.lineChannelId, channelId),
    })
    expect(broadcast?.status).toBe('linked')
  })

  it('r1 blocker: reply 失敗時のフォールバック push は③をメンション無しの素テキストへ降格する', async () => {
    await seedLinkableBroadcast()
    const admin = await createAdmin({
      lineUserId: 'Uadmin1a000000000000000000000000',
      lineLinkedAt: new Date(),
    })

    // reply 側は元 payload（メンション付き）を受け取ったうえで throw する。
    const replyCaptured: Array<readonly LineMessage[]> = []
    const throwingReply: LineReplyClient = {
      async reply({ messages }) {
        replyCaptured.push(messages)
        throw new Error('LINE reply failed: 400 mention rejected')
      },
    }
    const push = makePushClient()
    const membership = makeMembershipClient([admin.lineUserId!])
    await applyWebhookEvents(db, channelId, 'token', codePayload(), throwingReply, {
      membershipClient: membership.client,
      pushClient: push.client,
    })

    // reply には在籍プローブを通ったメンション付き③が積まれていた。
    expect((replyCaptured[0]![2]! as LineTextV2Message).type).toBe('textV2')
    // フォールバック push の③はメンション無しの素テキストへ降格される
    // （プローブ後の退出等で同じ payload が再び 400 になるのを防ぐ）。
    expect(push.captured).toHaveLength(1)
    const fallbackThird = push.captured[0]!.messages[2]!
    expect(fallbackThird.type).toBe('text')
    expect(fallbackThird.text).toContain('@管理者')
    expect(push.captured[0]!.messages).toHaveLength(4)
  })

  it('r1 blocker: プローブ中に紐付けが解除されたら案内を送らず linked_announce_skipped を記録する', async () => {
    await seedLinkableBroadcast()
    const admin = await createAdmin({
      lineUserId: 'Uadmin1a000000000000000000000000',
      lineLinkedAt: new Date(),
    })

    const logged: Array<{ event: string; ctx: Record<string, unknown> }> = []
    const reply = makeReplyClient()
    // プローブの最中に管理者の revoke が走った状況を、プローブ内の副作用で再現する。
    const revokingMembership = {
      async isMember({ userId }: { groupId: string; userId: string; channelAccessToken: string }) {
        await db
          .update(eventLineBroadcasts)
          .set({ status: 'revoked' })
          .where(eq(eventLineBroadcasts.lineChannelId, channelId))
        return userId === admin.lineUserId
      },
    }
    await applyWebhookEvents(db, channelId, 'token', codePayload(), reply.client, {
      membershipClient: revokingMembership,
      logger: (event, ctx) => logged.push({ event, ctx }),
    })

    // 送信直前の再検証が変化を検出し、案内は reply もフォールバック push も送られない。
    expect(reply.captured).toHaveLength(0)
    expect(logged.map((l) => l.event)).toContain('linked_announce_skipped')
  })

  it('AC-6: logger 未指定の既定では失敗イベントが console へ JSON 出力される', async () => {
    await seedLinkableBroadcast()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await applyWebhookEvents(db, channelId, 'token', codePayload(), makeThrowingReplyClient(), {
        pushClient: makePushClient(true).client,
      })
      const lines = errorSpy.mock.calls.map((args) => String(args[0]))
      const parsed = lines.map((l) => JSON.parse(l) as { src: string; event: string })
      expect(parsed.some((p) => p.src === 'line-webhook' && p.event === 'linked_reply_failed')).toBe(true)
      expect(parsed.some((p) => p.src === 'line-webhook' && p.event === 'linked_push_fallback_failed')).toBe(true)
    } finally {
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })
})
