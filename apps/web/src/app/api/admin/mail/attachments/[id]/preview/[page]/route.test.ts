import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())

const mockFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      mailAttachments: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
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
    'http://localhost:3000/api/admin/mail/attachments/1/preview/1',
  )
}

const mkParams = (id: string, page: string) => ({
  params: Promise.resolve({ id, page }),
})

const DOC_ROW = {
  id: 1,
  data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
  filename: '多摩大会案内.doc',
  contentType: 'application/msword',
}

describe('GET /api/admin/mail/attachments/:id/preview/:page', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
    mockGetCachedPreviewPage.mockReset()
    mockRenderAttachmentPreview.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await setAuthSession(null)
    const res = await GET(makeRequest(), mkParams('1', '1'))
    expect(res.status).toBe(401)
    expect(mockGetCachedPreviewPage).not.toHaveBeenCalled()
  })

  it('returns 403 when role is member', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('1', '1'))
    expect(res.status).toBe(403)
    expect(mockGetCachedPreviewPage).not.toHaveBeenCalled()
  })

  it('allows vice_admin (parity with admin)', async () => {
    await setAuthSession({ id: 'u1', role: 'vice_admin' })
    mockGetCachedPreviewPage.mockReturnValue({
      data: JPEG,
      contentType: 'image/jpeg',
    })
    const res = await GET(makeRequest(), mkParams('1', '1'))
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
    await setAuthSession({ id: 'u1', role: 'admin' })
    const res = await GET(makeRequest(), mkParams(id, page))
    expect(res.status).toBe(400)
    expect(mockGetCachedPreviewPage).not.toHaveBeenCalled()
  })

  it('returns 400 for ids beyond int4 max', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const res = await GET(makeRequest(), mkParams('999999999999999999999', '1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for pages beyond the render cap (can never exist)', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const res = await GET(makeRequest(), mkParams('1', '31'))
    expect(res.status).toBe(400)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('serves a cached page without touching the DB', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage.mockReturnValue({
      data: JPEG,
      contentType: 'image/jpeg',
    })
    const res = await GET(makeRequest(), mkParams('1', '2'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-length')).toBe(String(JPEG.length))
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(JPEG)))
  })

  it('returns 404 on cache miss when the attachment row is missing', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('99', '1'))
    expect(res.status).toBe(404)
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
  })

  it('returns 404 for attachments that are not previewable documents', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockFindFirst.mockResolvedValue({
      id: 1,
      data: Buffer.from('PK'),
      filename: 'archive.zip',
      contentType: 'application/zip',
    })
    const res = await GET(makeRequest(), mkParams('1', '1'))
    expect(res.status).toBe(404)
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
  })

  it('re-renders with force on a cache miss and serves the page', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ data: JPEG, contentType: 'image/jpeg' })
    mockFindFirst.mockResolvedValue(DOC_ROW)
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 3,
      truncated: false,
    })
    const res = await GET(makeRequest(), mkParams('1', '2'))
    expect(res.status).toBe(200)
    // force=true: a stale surviving meta must not short-circuit the
    // re-render when the page bytes themselves were evicted.
    expect(mockRenderAttachmentPreview).toHaveBeenCalledWith(DOC_ROW, {
      force: true,
    })
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(JPEG)))
  })

  it('returns 404 when the requested page exceeds the rendered page count', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockFindFirst.mockResolvedValue(DOC_ROW)
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 1,
      truncated: false,
    })
    const res = await GET(makeRequest(), mkParams('1', '2'))
    expect(res.status).toBe(404)
  })

  it('returns 502 when rendering fails', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockFindFirst.mockResolvedValue(DOC_ROW)
    mockRenderAttachmentPreview.mockRejectedValue(new Error('soffice crashed'))
    const res = await GET(makeRequest(), mkParams('1', '1'))
    expect(res.status).toBe(502)
  })

  it('returns 502 when the page is evicted again right after rendering', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockGetCachedPreviewPage.mockReturnValue(null)
    mockFindFirst.mockResolvedValue(DOC_ROW)
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 3,
      truncated: false,
    })
    const res = await GET(makeRequest(), mkParams('1', '1'))
    expect(res.status).toBe(502)
  })
})
