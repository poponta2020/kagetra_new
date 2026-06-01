import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { mailMessages, pushSubscriptions, users } from '@kagetra/shared/schema'

// web-push を hoisted モックで差し替え（実 HTTP を出さない）。
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  setVapid: vi.fn(),
}))
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: mocks.setVapid,
    sendNotification: mocks.send,
  },
}))

const { testDb, closeTestDb } = await import('../test-db.js')
const { notifyNewMailPush } = await import('../../src/notify/web-push.js')

const CONFIG = { publicKey: 'pub-key', privateKey: 'priv-key', subject: 'mailto:a@example.com' }

async function reset() {
  await testDb.execute(
    sql`TRUNCATE TABLE mail_messages, push_subscriptions, users RESTART IDENTITY CASCADE`,
  )
}

async function seedUser(role: 'admin' | 'vice_admin' | 'member') {
  const [u] = await testDb
    .insert(users)
    .values({
      name: `u-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.com`,
      role,
      isInvited: true,
    })
    .returning()
  if (!u) throw new Error('seed user failed')
  return u
}

async function seedSub(userId: string, endpoint: string) {
  await testDb.insert(pushSubscriptions).values({
    userId,
    endpoint,
    p256dh: 'p256',
    auth: 'authk',
  })
}

async function seedMail(triageStatus: 'unprocessed' | 'processed' | 'deferred') {
  await testDb.insert(mailMessages).values({
    messageId: `<${crypto.randomUUID()}@test>`,
    fromAddress: 'organizer@example.com',
    toAddresses: ['kagetra@example.com'],
    receivedAt: new Date(),
    triageStatus,
  })
}

describe('notifyNewMailPush (mail-triage-badge)', () => {
  beforeEach(async () => {
    await reset()
    mocks.send.mockReset()
    mocks.setVapid.mockReset()
    mocks.send.mockResolvedValue(undefined)
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('admin/vice_admin の購読へ送信し、badge=未処理数(processed以外)を載せる', async () => {
    const admin = await seedUser('admin')
    const vice = await seedUser('vice_admin')
    const member = await seedUser('member')
    await seedSub(admin.id, 'https://push.example/admin')
    await seedSub(vice.id, 'https://push.example/vice')
    await seedSub(member.id, 'https://push.example/member') // 対象外
    await seedMail('unprocessed')
    await seedMail('deferred')
    await seedMail('processed') // バッジに含めない

    await notifyNewMailPush(testDb, CONFIG, {
      subject: 'テスト大会のご案内',
      fromName: '主催者',
      fromAddress: 'organizer@example.com',
    })

    // admin + vice の 2 件のみ（member は除外）
    expect(mocks.send).toHaveBeenCalledTimes(2)
    const payload = JSON.parse(mocks.send.mock.calls[0]![1] as string)
    expect(payload.badge).toBe(2) // unprocessed + deferred
    expect(payload.url).toBe('/admin/mail-inbox')
    expect(payload.body).toContain('テスト大会のご案内')
    expect(payload.body).toContain('主催者')
  })

  it('購読が無ければ送信しない', async () => {
    await seedUser('admin') // 購読なし
    await notifyNewMailPush(testDb, CONFIG, {
      subject: 'S',
      fromName: null,
      fromAddress: 'f@example.com',
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('HTTP 410 の購読は削除する', async () => {
    const admin = await seedUser('admin')
    await seedSub(admin.id, 'https://push.example/gone')
    mocks.send.mockRejectedValueOnce({ statusCode: 410 })

    await notifyNewMailPush(testDb, CONFIG, {
      subject: 'S',
      fromName: null,
      fromAddress: 'f@example.com',
    })

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(0)
  })

  it('HTTP 404 の購読も削除する', async () => {
    const admin = await seedUser('admin')
    await seedSub(admin.id, 'https://push.example/notfound')
    mocks.send.mockRejectedValueOnce({ statusCode: 404 })

    await notifyNewMailPush(testDb, CONFIG, {
      subject: 'S',
      fromName: null,
      fromAddress: 'f@example.com',
    })

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(0)
  })

  it('一時エラー(500)では購読を削除しない', async () => {
    const admin = await seedUser('admin')
    await seedSub(admin.id, 'https://push.example/temp')
    mocks.send.mockRejectedValueOnce({ statusCode: 500 })

    await notifyNewMailPush(testDb, CONFIG, {
      subject: 'S',
      fromName: null,
      fromAddress: 'f@example.com',
    })

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(1)
  })

  it('fromName が無ければ fromAddress を本文に使う', async () => {
    const admin = await seedUser('admin')
    await seedSub(admin.id, 'https://push.example/x')

    await notifyNewMailPush(testDb, CONFIG, {
      subject: 'S',
      fromName: null,
      fromAddress: 'from@example.com',
    })

    const payload = JSON.parse(mocks.send.mock.calls[0]![1] as string)
    expect(payload.body).toContain('from@example.com')
  })
})
