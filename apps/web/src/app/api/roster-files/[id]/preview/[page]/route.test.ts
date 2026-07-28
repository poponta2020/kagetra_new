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

const mockGetCachedPreviewPage = vi.fn()
const mockRenderAttachmentPreview = vi.fn()
vi.mock('@/lib/attachment-preview', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/attachment-preview')>()
  return {
    ...actual,
    getCachedPreviewPage: (...args: unknown[]) =>
      mockGetCachedPreviewPage(...args),
    renderAttachmentPreview: (...args: unknown[]) =>
      mockRenderAttachmentPreview(...args),
  }
})

const { GET } = await import('./route')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xee])

function makeRequest(): Request {
  return new Request(
    'http://localhost:3000/api/roster-files/5/preview/1',
  )
}

const mkParams = (id: string, page: string) => ({
  params: Promise.resolve({ id, page }),
})

const ADOPTED_DOC_ROW = {
  id: 5,
  rosterType: 'confirmed' as const,
  publishedAt: null,
  sourceAttachment: {
    id: 1,
    filename: '多摩大会案内.doc',
    contentType: 'application/msword',
  },
}

const DOC_ATTACHMENT_ROW = {
  id: 1,
  data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
  filename: '多摩大会案内.doc',
  contentType: 'application/msword',
}

describe('GET /api/roster-files/:id/preview/:page', () => {
  beforeEach(() => {
    mockRosterFileFindFirst.mockReset()
    mockAttachmentFindFirst.mockReset()
    mockGetCachedPreviewPage.mockReset()
    mockRenderAttachmentPreview.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await setAuthSession(null)
    const res = await GET(makeRequest(), mkParams('5', '1'))
    expect(res.status).toBe(401)
    expect(mockRosterFileFindFirst).not.toHaveBeenCalled()
  })

  it('allows plain member role (no role gate)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage.mockReturnValue({
      data: JPEG,
      contentType: 'image/jpeg',
    })
    const res = await GET(makeRequest(), mkParams('5', '1'))
    expect(res.status).toBe(200)
  })

  it.each([
    ['abc', '1'],
    ['0', '1'],
    ['01', '1'],
    ['1.5', '1'],
    ['1', 'abc'],
    ['1', '0'],
    ['1', '02'],
  ])('returns 400 for non-canonical path id=%p page=%p', async (id, page) => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams(id, page))
    expect(res.status).toBe(400)
    expect(mockRosterFileFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 for ids beyond int4 max', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('999999999999999999999', '1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for pages beyond the render cap (can never exist)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('5', '31'))
    expect(res.status).toBe(400)
    expect(mockRosterFileFindFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no adoption row (未採用・解除済み・fail-closed)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('99', '1'))
    expect(res.status).toBe(404)
    expect(mockGetCachedPreviewPage).not.toHaveBeenCalled()
  })

  it('serves a cached page without touching the DB again or re-rendering', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage.mockReturnValue({
      data: JPEG,
      contentType: 'image/jpeg',
    })
    const res = await GET(makeRequest(), mkParams('5', '2'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-length')).toBe(String(JPEG.length))
    // loadAdoptedRosterFile が毎回非キャッシュで採用状態を確認するため、
    // admin route のようなキャッシュヒット時の再存在確認は不要
    // （ON DELETE CASCADE で添付削除は採用行ごと道連れになる）。
    expect(mockAttachmentFindFirst).not.toHaveBeenCalled()
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(JPEG)))
  })

  it('returns 404 on cache miss when the attachment row is missing (defensive)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockAttachmentFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('5', '1'))
    expect(res.status).toBe(404)
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
  })

  it('returns 404 for attachments that are not previewable documents', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue({
      ...ADOPTED_DOC_ROW,
      sourceAttachment: {
        id: 1,
        filename: 'archive.zip',
        contentType: 'application/zip',
      },
    })
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockAttachmentFindFirst.mockResolvedValue({
      id: 1,
      data: Buffer.from('PK'),
      filename: 'archive.zip',
      contentType: 'application/zip',
    })
    const res = await GET(makeRequest(), mkParams('5', '1'))
    expect(res.status).toBe(404)
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
  })

  it('re-renders with force on a cache miss and serves the page', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ data: JPEG, contentType: 'image/jpeg' })
    mockAttachmentFindFirst.mockResolvedValue(DOC_ATTACHMENT_ROW)
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 3,
      truncated: false,
    })
    const res = await GET(makeRequest(), mkParams('5', '2'))
    expect(res.status).toBe(200)
    expect(mockRenderAttachmentPreview).toHaveBeenCalledWith(
      DOC_ATTACHMENT_ROW,
      { force: true },
    )
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(JPEG)))
  })

  it('returns 404 when the requested page exceeds the rendered page count', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockAttachmentFindFirst.mockResolvedValue(DOC_ATTACHMENT_ROW)
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 1,
      truncated: false,
    })
    const res = await GET(makeRequest(), mkParams('5', '2'))
    expect(res.status).toBe(404)
  })

  it('returns 502 when rendering fails', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockAttachmentFindFirst.mockResolvedValue(DOC_ATTACHMENT_ROW)
    mockRenderAttachmentPreview.mockRejectedValue(new Error('soffice crashed'))
    const res = await GET(makeRequest(), mkParams('5', '1'))
    expect(res.status).toBe(502)
  })

  it('returns 502 when the page is evicted again right after rendering', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_DOC_ROW)
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockAttachmentFindFirst.mockResolvedValue(DOC_ATTACHMENT_ROW)
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 3,
      truncated: false,
    })
    const res = await GET(makeRequest(), mkParams('5', '1'))
    expect(res.status).toBe(502)
  })
})
