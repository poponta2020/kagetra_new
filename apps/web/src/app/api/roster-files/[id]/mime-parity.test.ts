/**
 * roster-file-adoption タスク3・実装上の必読ポイント3:
 *
 * MIME allowlist / Content-Disposition の判定ロジックは
 * `/api/admin/mail/attachments/[id]/route.ts` にインラインで書かれていて
 * export されていないため、`/api/roster-files/[id]/route.ts` へ複製している。
 * admin route は変更しない契約なので、この複製が「同じ判定結果になる」ことを
 * 両方の GET を同じ入力で叩いて突き合わせるテストで固定する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())

const mockRosterFileFindFirst = vi.fn()
const mockAttachmentFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      tournamentEntryRosterFiles: {
        findFirst: (...args: unknown[]) => mockRosterFileFindFirst(...args),
      },
      mailAttachments: {
        findFirst: (...args: unknown[]) => mockAttachmentFindFirst(...args),
      },
    },
  },
}))

const { GET: memberGET } = await import('./route')
const { GET: adminGET } = await import(
  '../../admin/mail/attachments/[id]/route'
)

const memberParams = { params: Promise.resolve({ id: '5' }) }
const adminParams = { params: Promise.resolve({ id: '1' }) }

function makeRosterFileRow(filename: string, contentType: string) {
  return {
    id: 5,
    rosterType: 'confirmed' as const,
    publishedAt: null,
    sourceAttachment: { id: 42, filename, contentType },
  }
}

// 網羅対象: admin route の route.test.ts が固定しているケースと同じ集合
// （素直に allowlist に載る型 / active content として弾くべき型 / 壊れた・
// 空の Content-Type）。
const CASES: Array<{ filename: string; contentType: string }> = [
  { filename: '案内.pdf', contentType: 'application/pdf' },
  {
    filename: '申込書.docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { filename: '32rd(A-E)多摩大会案内.doc', contentType: 'application/msword' },
  { filename: '会場地図.png', contentType: 'image/png' },
  { filename: 'evil.html', contentType: 'text/html' },
  { filename: 'evil.svg', contentType: 'image/svg+xml' },
  { filename: 'feed.xml', contentType: 'application/rss+xml' },
  { filename: 'feed2.xml', contentType: 'application/atom+xml' },
  { filename: 'other.bin', contentType: 'application/zip' },
  { filename: 'other2.bin', contentType: 'application/ecmascript' },
  { filename: 'other3.bin', contentType: 'text/vtt' },
  { filename: 'weird.bin', contentType: 'not a mime' },
  { filename: 'weird2.bin', contentType: 'application/we"ird' },
  { filename: 'weird3.bin', contentType: 'application/pdf,text/html' },
  { filename: 'weird4.bin', contentType: '' },
  { filename: 'weird5.bin', contentType: 'application/pdf; bogus=1' },
]

describe('member roster-files route matches admin attachments route allowlist decisions', () => {
  beforeEach(() => {
    mockRosterFileFindFirst.mockReset()
    mockAttachmentFindFirst.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(CASES)(
    'agrees on content-type / disposition for %j',
    async ({ filename, contentType }) => {
      const data = Buffer.from('payload')

      await setAuthSession({ id: 'admin1', role: 'admin' })
      mockAttachmentFindFirst.mockResolvedValue({
        data,
        filename,
        contentType,
        sizeBytes: data.length,
      })
      const adminRes = await adminGET(
        new Request('http://localhost:3000/api/admin/mail/attachments/1'),
        adminParams,
      )

      await setAuthSession({ id: 'u1', role: 'member' })
      mockRosterFileFindFirst.mockResolvedValue(
        makeRosterFileRow(filename, contentType),
      )
      mockAttachmentFindFirst.mockResolvedValue({
        data,
        filename,
        contentType,
      })
      const memberRes = await memberGET(
        new Request('http://localhost:3000/api/roster-files/5'),
        memberParams,
      )

      expect(memberRes.status).toBe(adminRes.status)
      expect(memberRes.headers.get('content-type')).toBe(
        adminRes.headers.get('content-type'),
      )
      const adminDispositionType = (
        adminRes.headers.get('content-disposition') ?? ''
      ).split(';')[0]
      const memberDispositionType = (
        memberRes.headers.get('content-disposition') ?? ''
      ).split(';')[0]
      expect(memberDispositionType).toBe(adminDispositionType)
      expect(memberRes.headers.get('x-content-type-options')).toBe(
        adminRes.headers.get('x-content-type-options'),
      )
    },
  )
})
