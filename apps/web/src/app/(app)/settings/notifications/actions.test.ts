import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushSubscriptions } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { savePushSubscription, deletePushSubscription } = await import('./actions')

describe('settings/notifications actions (mail-triage-badge)', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('savePushSubscription: 購読を保存する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await savePushSubscription({
      endpoint: 'https://push.example/abc',
      p256dh: 'key1',
      auth: 'auth1',
      userAgent: 'UA/1.0',
    })

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.endpoint).toBe('https://push.example/abc')
    expect(rows[0]?.userId).toBe(admin.id)
    expect(rows[0]?.p256dh).toBe('key1')
    expect(rows[0]?.userAgent).toBe('UA/1.0')
  })

  it('同一 endpoint の再購読は upsert（重複させず鍵を更新）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await savePushSubscription({ endpoint: 'https://push.example/x', p256dh: 'old', auth: 'a1' })
    await savePushSubscription({ endpoint: 'https://push.example/x', p256dh: 'new', auth: 'a2' })

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.p256dh).toBe('new')
    expect(rows[0]?.auth).toBe('a2')
  })

  it('vice_admin も保存できる', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    await savePushSubscription({ endpoint: 'https://push.example/v', p256dh: 'k', auth: 'a' })

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(vice.id)
  })

  it('endpoint / 鍵が欠けると invalid subscription', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await expect(
      savePushSubscription({ endpoint: '', p256dh: 'k', auth: 'a' }),
    ).rejects.toThrow('invalid subscription')
    await expect(
      savePushSubscription({ endpoint: 'e', p256dh: '', auth: 'a' }),
    ).rejects.toThrow('invalid subscription')
  })

  it('未認証 / member は保存できない', async () => {
    await setAuthSession(null)
    await expect(
      savePushSubscription({ endpoint: 'e', p256dh: 'k', auth: 'a' }),
    ).rejects.toThrow('Unauthorized')

    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(
      savePushSubscription({ endpoint: 'e', p256dh: 'k', auth: 'a' }),
    ).rejects.toThrow('Forbidden')

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(0)
  })

  it('deletePushSubscription: endpoint で削除する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await savePushSubscription({ endpoint: 'https://push.example/del', p256dh: 'k', auth: 'a' })

    await deletePushSubscription('https://push.example/del')

    const rows = await testDb.select().from(pushSubscriptions)
    expect(rows).toHaveLength(0)
  })

  it('deletePushSubscription: member は呼べない', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(deletePushSubscription('e')).rejects.toThrow('Forbidden')
  })
})
