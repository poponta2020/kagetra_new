import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clubLineGroups, lineChannels, lineChatTasks, membershipRenewals } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { GET } from './route'

const TOKEN = 'route-test-line-chat-worker-token'

function request(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/line-chat-worker/tasks', { headers })
}

async function seedRenewal() {
  const [row] = await testDb
    .insert(membershipRenewals)
    .values({ fiscalYear: 2026, deadline: '2026-04-30' })
    .returning()
  if (!row) throw new Error('failed to seed membership_renewals')
  return row
}

async function seedClubLineGroup() {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-club-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'club-token',
      botId: '@club-bot',
      purpose: 'club_chat',
      status: 'assigned',
    })
    .returning()
  if (!channel) throw new Error('failed to seed line_channels')
  const [group] = await testDb
    .insert(clubLineGroups)
    .values({
      lineChannelId: channel.id,
      oamAccountPath: 'U1234567890abcdef1234567890abcdef',
      oamChatRoomId: 'Cabcdef1234567890abcdef1234567890',
      chatRoomName: '北大かるた会',
    })
    .returning()
  if (!group) throw new Error('failed to seed club_line_groups')
  return group
}

describe('GET /api/line-chat-worker/tasks', () => {
  beforeEach(async () => {
    await truncateAll()
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', TOKEN)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('AC-21: トークン無しは 401', async () => {
    const res = await GET(request())
    expect(res.status).toBe(401)
  })

  it('AC-21: トークン不一致は 403（401 と区別する）', async () => {
    const res = await GET(request({ 'x-service-token': 'wrong-token' }))
    expect(res.status).toBe(403)
  })

  it('AC-21: env 未設定なら正しい値でも 403', async () => {
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', undefined)
    const res = await GET(request({ 'x-service-token': TOKEN }))
    expect(res.status).toBe(403)
  })

  it('club_line_groups 未設定なら 200・空配列', async () => {
    const renewal = await seedRenewal()
    await testDb.insert(lineChatTasks).values({
      renewalId: renewal.id,
      kind: 'reminder',
      targetDate: '2026-03-10',
      scheduledSendAt: new Date(Date.now() + 60 * 60_000),
      messageText: '本文',
      status: 'PENDING',
    })
    const res = await GET(request({ 'x-service-token': TOKEN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('AC-22: WorkerTask 契約形（broadcastGroupId を含まない）で 200 を返し no-store', async () => {
    const group = await seedClubLineGroup()
    const renewal = await seedRenewal()
    const scheduledSendAt = new Date(Date.now() + 60 * 60_000)
    const [task] = await testDb
      .insert(lineChatTasks)
      .values({
        renewalId: renewal.id,
        kind: 'reminder',
        targetDate: '2026-03-10',
        scheduledSendAt,
        messageText: '本文A',
        status: 'PENDING',
      })
      .returning()

    const res = await GET(request({ 'x-service-token': TOKEN }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1)
    expect(body[0]).toEqual({
      id: task!.id,
      status: 'PENDING',
      chatRoomId: group.oamChatRoomId,
      chatRoomName: group.chatRoomName,
      scheduledSendAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/),
      messageText: '本文A',
    })
    expect(body[0]).not.toHaveProperty('broadcastGroupId')
    expect(body[0]).not.toHaveProperty('sessionId')
  })
})
