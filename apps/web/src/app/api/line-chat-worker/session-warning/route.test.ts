import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { POST } from './route'

const TOKEN = 'route-test-line-chat-worker-token'

function request(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/line-chat-worker/session-warning', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
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

describe('POST /api/line-chat-worker/session-warning', () => {
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
    expect((await POST(request({ message: 'x' }))).status).toBe(401)
    expect(
      (await POST(request({ message: 'x' }, { 'x-service-token': 'wrong' }))).status,
    ).toBe(403)
  })

  it('AC-23: 管理者個人 LINE へ定型文＋要点で中継される（本文をそのまま横流ししない）', async () => {
    await seedSystemChannel()
    const res = await POST(
      request(
        { message: 'セッションが切れそうです', roomUrl: 'https://chat.line.biz/Uxxxxx/chat/Cyyyyy' },
        { 'x-service-token': TOKEN },
      ),
    )
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(fetch).mock.calls[0]!
    const body = JSON.parse(String((call[1] as RequestInit).body)) as {
      to: string
      messages: { text: string }[]
    }
    expect(body.to).toBe('Uadmin123')
    const text = body.messages[0]!.text
    expect(text).toContain('セッションが切れそうです')
    // ワーカーが送ってきた任意フィールド（roomUrl 等）はそのまま横流ししない。
    expect(text).not.toContain('chat.line.biz')
    expect(text).not.toContain('roomUrl')
  })

  it('message が無い body でも 200 で定型文だけ通知する', async () => {
    await seedSystemChannel()
    const res = await POST(request({}, { 'x-service-token': TOKEN }))
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(fetch).mock.calls[0]!
    const body = JSON.parse(String((call[1] as RequestInit).body)) as {
      messages: { text: string }[]
    }
    expect(body.messages[0]!.text).toContain('セッション警告')
  })

  it('不正な JSON body でも 200（定型文のみで通知）', async () => {
    await seedSystemChannel()
    const res = await POST(
      new Request('http://localhost/api/line-chat-worker/session-warning', {
        method: 'POST',
        headers: { 'x-service-token': TOKEN, 'content-type': 'application/json' },
        body: 'not-json',
      }),
    )
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('system_notify 未設定でも 500 にしない', async () => {
    const res = await POST(request({ message: 'x' }, { 'x-service-token': TOKEN }))
    expect(res.status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
  })
})
