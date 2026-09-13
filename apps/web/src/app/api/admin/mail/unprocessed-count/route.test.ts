import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailWorkerJobs } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
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

  // tournament-results 2026-09-13 改修 タスク3: 一覧・badge と同じ
  // countUnprocessedMails を経由するため、取込中のメールは数えない（AC-24/AC-31）。
  it('取込中のメールは未処理件数から除外する（AC-24）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const inFlight = await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'processed' })
    await testDb.insert(mailWorkerJobs).values({
      requestedByUserId: admin.id,
      status: 'pending',
      kind: 'result_parse',
      payload: { mail_message_id: inFlight.id, attachment_id: 1 },
      requestedAt: new Date(),
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)
  })

  it('取込中がゼロなら現行と同値（回帰）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'unprocessed' })
    await createMailMessage({ triageStatus: 'processed' })

    const res = await GET()
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
