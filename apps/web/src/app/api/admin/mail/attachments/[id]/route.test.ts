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

const { GET } = await import('./route')

function makeRequest(): Request {
  return new Request('http://localhost:3000/api/admin/mail/attachments/1')
}

const mkParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/admin/mail/attachments/:id', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await setAuthSession(null)
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(401)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('returns 403 when role is member', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(403)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('allows vice_admin (parity with admin)', async () => {
    await setAuthSession({ id: 'u1', role: 'vice_admin' })
    mockFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for non-numeric id', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const res = await GET(makeRequest(), mkParams('abc'))
    expect(res.status).toBe(400)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 for non-positive id', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const res = await GET(makeRequest(), mkParams('0'))
    expect(res.status).toBe(400)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it.each(['1.5', '1e5', '01', '-1', ' 1', '1 '])(
    'returns 400 for non-canonical id %p (parseInt would silently coerce)',
    async (badId) => {
      await setAuthSession({ id: 'u1', role: 'admin' })
      const res = await GET(makeRequest(), mkParams(badId))
      expect(res.status).toBe(400)
      expect(mockFindFirst).not.toHaveBeenCalled()
    },
  )

  it('returns 404 when the row is missing', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('99'))
    expect(res.status).toBe(404)
  })

  it('serves PDF inline with the original Content-Type and nosniff', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from('%PDF-1.4 fake body')
    mockFindFirst.mockResolvedValue({
      data,
      filename: '案内.pdf',
      contentType: 'application/pdf',
      sizeBytes: data.length,
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-length')).toBe(String(data.length))
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.byteLength).toBe(data.length)
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(data)))
  })

  it('forces HTML attachments to octet-stream + attachment to deny stored XSS', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from('<script>alert(1)</script>')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'evil.html',
      contentType: 'text/html',
      sizeBytes: data.length,
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('forces SVG attachments to octet-stream + attachment', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      sizeBytes: data.length,
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('forces DOCX attachments to octet-stream + attachment', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    mockFindFirst.mockResolvedValue({
      data,
      filename: '申込書.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: data.length,
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('rejects header-injection attempts in stored Content-Type', async () => {
    // A hostile sender could try to smuggle "application/pdf" via the
    // allowlist by appending parameters; the route strips parameters before
    // checking and never echoes the raw value back.
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from('<svg/>')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'evil.svg',
      contentType: 'application/pdf; bogus=1',
      sizeBytes: data.length,
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    // Parameter stripped → matches the allowlist → inline + application/pdf.
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    // Whatever the stored value, the response carries no `; bogus=1`.
    expect(res.headers.get('content-type')).not.toContain('bogus')
  })

  it('uses data.length for body + Content-Length even when sizeBytes column disagrees', async () => {
    // Writer (imap-client) falls back to `data.length` when mailparser
    // misreports `part.size`, so the column can drift. Trusting the column
    // here would either RangeError (column < data) or return a zero-padded
    // body the browser waits forever on (column > data).
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from('%PDF-1.4 mismatch')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: data.length + 100, // intentionally wrong
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(data.length))
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.byteLength).toBe(data.length)
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(data)))
  })

  it('emits both legacy filename= and RFC 5987 filename*= for non-ASCII names', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    const data = Buffer.from('%PDF-1.4')
    mockFindFirst.mockResolvedValue({
      data,
      filename: '大会要項.pdf',
      contentType: 'application/pdf',
      sizeBytes: data.length,
    })
    const res = await GET(makeRequest(), mkParams('1'))
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).toContain('filename="')
    expect(cd).toContain("filename*=UTF-8''")
    // The percent-encoded UTF-8 form must include the encoded Japanese bytes.
    expect(cd).toContain(encodeURIComponent('大会要項.pdf'))
  })
})
