import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { lineChannels, lineChatTasks, membershipRenewals } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { POST } from './route'

const TOKEN = 'route-test-line-chat-worker-token'

function request(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/line-chat-worker/1/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

async function seedRenewal() {
  const [row] = await testDb
    .insert(membershipRenewals)
    .values({ fiscalYear: 2026, deadline: '2026-04-30' })
    .returning()
  if (!row) throw new Error('failed to seed membership_renewals')
  return row
}

async function seedTask(overrides: Partial<typeof lineChatTasks.$inferInsert> = {}) {
  const renewal = await seedRenewal()
  const [row] = await testDb
    .insert(lineChatTasks)
    .values({
      renewalId: renewal.id,
      kind: 'reminder',
      targetDate: '2026-03-10',
      scheduledSendAt: new Date(Date.now() + 60 * 60_000),
      messageText: '本文',
      status: 'PENDING',
      ...overrides,
    })
    .returning()
  if (!row) throw new Error('failed to seed line_chat_tasks')
  return row
}

async function seedSystemChannel() {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-sys-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'sys-token',
      botId: '@sys-bot',
      purpose: 'system_notify',
      status: 'system',
      notificationLineUserId: 'Uadmin123',
    })
    .returning()
  if (!channel) throw new Error('failed to seed system channel')
  return channel
}

describe('POST /api/line-chat-worker/[id]/result', () => {
  beforeEach(async () => {
    await truncateAll()
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', TOKEN)
    delete process.env.LINE_NOTIFY_DRY_RUN
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('AC-21: トークン無しは 401、不正は 403', async () => {
    const task = await seedTask()
    expect((await POST(request({ status: 'RESERVING' }), params(String(task.id)))).status).toBe(
      401,
    )
    expect(
      (
        await POST(
          request({ status: 'RESERVING' }, { 'x-service-token': 'wrong' }),
          params(String(task.id)),
        )
      ).status,
    ).toBe(403)
  })

  it('不正な id 形式は 400', async () => {
    const res = await POST(
      request({ status: 'RESERVING' }, { 'x-service-token': TOKEN }),
      params('not-a-number'),
    )
    expect(res.status).toBe(400)
  })

  it('未知の status 文字列は 400', async () => {
    const task = await seedTask()
    const res = await POST(
      request({ status: 'NOPE' }, { 'x-service-token': TOKEN }),
      params(String(task.id)),
    )
    expect(res.status).toBe(400)
  })

  it('存在しない id は 404', async () => {
    const res = await POST(
      request({ status: 'RESERVING' }, { 'x-service-token': TOKEN }),
      params('999999'),
    )
    expect(res.status).toBe(404)
  })

  it('遷移表に無い遷移は 409', async () => {
    const task = await seedTask({ status: 'PENDING' })
    const res = await POST(
      request({ status: 'RESERVED' }, { 'x-service-token': TOKEN }),
      params(String(task.id)),
    )
    expect(res.status).toBe(409)
  })

  it('PENDING → RESERVING が 200 で成立する', async () => {
    const task = await seedTask({ status: 'PENDING' })
    const res = await POST(
      request({ status: 'RESERVING' }, { 'x-service-token': TOKEN }),
      params(String(task.id)),
    )
    expect(res.status).toBe(200)
    const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
    expect(row!.status).toBe('RESERVING')
  })

  it('mentionResult が保存される', async () => {
    const task = await seedTask({ status: 'RESERVING' })
    const res = await POST(
      request(
        {
          status: 'RESERVED',
          mentionResult: { matched: ['山田太郎'], unmatched: [] },
        },
        { 'x-service-token': TOKEN },
      ),
      params(String(task.id)),
    )
    expect(res.status).toBe(200)
    const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
    expect(row!.mentionResult).toEqual({ matched: ['山田太郎'], unmatched: [] })
  })

  it('AC-23: FAILED 報告で管理者個人 LINE へ通知される', async () => {
    await seedSystemChannel()
    const task = await seedTask({ status: 'RESERVING' })
    const res = await POST(
      request(
        { status: 'FAILED', errorCode: 'RESERVE_FAILED', errorMessage: '予約に失敗しました' },
        { 'x-service-token': TOKEN },
      ),
      params(String(task.id)),
    )
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(fetch).mock.calls[0]!
    const body = JSON.parse(String((call[1] as RequestInit).body)) as {
      to: string
      messages: { text: string }[]
    }
    expect(body.to).toBe('Uadmin123')
    expect(body.messages[0]!.text).toContain(String(task.id))
    expect(body.messages[0]!.text).toContain('予約に失敗しました')
  })

  it('AC-23: MANUAL_REVIEW_REQUIRED 報告でも通知される', async () => {
    await seedSystemChannel()
    const task = await seedTask({ status: 'RESERVING' })
    await POST(
      request({ status: 'MANUAL_REVIEW_REQUIRED' }, { 'x-service-token': TOKEN }),
      params(String(task.id)),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('RESERVED 報告では通知しない', async () => {
    await seedSystemChannel()
    const task = await seedTask({ status: 'RESERVING' })
    await POST(request({ status: 'RESERVED' }, { 'x-service-token': TOKEN }), params(String(task.id)))
    expect(fetch).not.toHaveBeenCalled()
  })
})
