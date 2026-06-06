import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createMailMessage, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())

const { GET } = await import('./route')

describe('GET /api/admin/mail/unprocessed-count', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  // mail-inbox-mailer: deferred 廃止。未処理は unprocessed のみで数える。
  it('未処理(unprocessed)を数え processed は除外する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'processed' })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(3)
  })

  it('メール0件なら count=0', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const res = await GET()
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('vice_admin もアクセスできる', async () => {
    const vice = await createUser({ role: 'vice_admin' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })
    await createMailMessage({ triageStatus: 'unprocessed' })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(1)
  })

  it('未認証は 401', async () => {
    await setAuthSession(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('member は 403', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const res = await GET()
    expect(res.status).toBe(403)
  })
})
