import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// travel-report タスク4: 原本 dotx ダウンロード route の 403/200（AC-29）。

vi.mock('@/auth', () => mockAuthModule())

const { GET } = await import('./route')

describe('GET /api/admin/travel-reports/template', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未ログインは 401', async () => {
    await setAuthSession(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('一般会員（フラグ無し）は 403', async () => {
    const member = await createUser({ isTravelReportSubmitter: false })
    await setAuthSession({ id: member.id, role: 'member' })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('ゲストはフラグがあっても 403', async () => {
    const guest = await createGuest({ isTravelReportSubmitter: true })
    await setAuthSession({ id: guest.id, role: 'guest' })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('admin は 200 で dotx を返す', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    )
    const disposition = res.headers.get('Content-Disposition')
    expect(disposition).toContain('attachment')
    expect(disposition).toContain("filename*=UTF-8''")
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
  })

  it('vice_admin は 200', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('副連絡責任者フラグを持つ一般会員は 200（AC-21）', async () => {
    const submitter = await createUser({ isTravelReportSubmitter: true })
    await setAuthSession({ id: submitter.id, role: 'member' })
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('退会済みの副連絡責任者は 403', async () => {
    const submitter = await createUser({
      isTravelReportSubmitter: true,
      deactivatedAt: new Date(),
    })
    await setAuthSession({ id: submitter.id, role: 'member' })
    const res = await GET()
    expect(res.status).toBe(403)
  })
})
