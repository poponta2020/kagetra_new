import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { travelReportBatches, travelReportDocuments } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup, createGuest, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// travel-report タスク7: 生成 docx のダウンロード route（AC-27）。
// 生成物には全員の電話番号が入るので、提出権限者以外は 403（公開 URL は作らない）。

vi.mock('@/auth', () => mockAuthModule())

const { GET } = await import('./route')

const FILENAME = '2026.11.7,8 帯広新人戦 遠征届.docx'

async function seedDocument(): Promise<number> {
  const group = await createEntryGroup()
  const creator = await createAdmin()
  const [batch] = await testDb
    .insert(travelReportBatches)
    .values({ entryGroupId: group.id, createdBy: creator.id })
    .returning({ id: travelReportBatches.id })
  const [doc] = await testDb
    .insert(travelReportDocuments)
    .values({
      batchId: batch!.id,
      eventIds: [1, 2],
      filename: FILENAME,
      docx: Buffer.from('PK-fake-docx'),
      header: { purpose: 'テスト' },
      memberCount: 3,
    })
    .returning({ id: travelReportDocuments.id })
  return doc!.id
}

const call = (id: number | string) =>
  GET(new Request('http://localhost/api/admin/travel-reports/1'), {
    params: Promise.resolve({ id: String(id) }),
  })

describe('GET /api/admin/travel-reports/[id]', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未ログインは 401', async () => {
    const id = await seedDocument()
    await setAuthSession(null)
    expect((await call(id)).status).toBe(401)
  })

  it('一般会員（フラグ無し）は 403', async () => {
    const id = await seedDocument()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    expect((await call(id)).status).toBe(403)
  })

  it('ゲストはフラグがあっても 403', async () => {
    const id = await seedDocument()
    const guest = await createGuest({ isTravelReportSubmitter: true })
    await setAuthSession({ id: guest.id, role: 'guest' })
    expect((await call(id)).status).toBe(403)
  })

  it('副連絡責任者フラグ付きの一般会員は 200 で docx を返す（RFC 5987）', async () => {
    const id = await seedDocument()
    const submitter = await createUser({ isTravelReportSubmitter: true })
    await setAuthSession({ id: submitter.id, role: 'member' })
    const res = await call(id)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    const disposition = res.headers.get('Content-Disposition') ?? ''
    expect(disposition).toContain('attachment;')
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(FILENAME)}`)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PK-fake-docx')
  })

  it('存在しない id・不正な id は 404', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    expect((await call(999999)).status).toBe(404)
    expect((await call('abc')).status).toBe(404)
    expect((await call(0)).status).toBe(404)
  })

  it('★認可は id の存在確認より先（存在しない id でも権限が無ければ 403）', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    expect((await call(999999)).status).toBe(403)
  })
})
