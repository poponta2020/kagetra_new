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
  return new Request('http://localhost:3000/api/mail/attachments/1')
}

const mkParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/mail/attachments/:id', () => {
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

  it('returns 200 for role=member (unlike the admin route, which 403s)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from('%PDF-1.4 fake body')
    mockFindFirst.mockResolvedValue({
      data,
      filename: '案内.pdf',
      contentType: 'application/pdf',
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
  })

  it('allows vice_admin', async () => {
    await setAuthSession({ id: 'u1', role: 'vice_admin' })
    mockFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(404)
  })

  it('allows admin', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for non-numeric id', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('abc'))
    expect(res.status).toBe(400)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 for non-positive id', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('0'))
    expect(res.status).toBe(400)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it.each(['1.5', '1e5', '01', '-1', ' 1', '1 '])(
    'returns 400 for non-canonical id %p (parseInt would silently coerce)',
    async (badId) => {
      await setAuthSession({ id: 'u1', role: 'member' })
      const res = await GET(makeRequest(), mkParams(badId))
      expect(res.status).toBe(400)
      expect(mockFindFirst).not.toHaveBeenCalled()
    },
  )

  it('returns 400 for ids beyond int4 max (would 500 from pg otherwise)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('2147483648'))
    expect(res.status).toBe(400)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when the row is missing', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('99'))
    expect(res.status).toBe(404)
  })

  it('serves PDF inline with the original Content-Type and nosniff', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from('%PDF-1.4 fake body')
    mockFindFirst.mockResolvedValue({
      data,
      filename: '案内.pdf',
      contentType: 'application/pdf',
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

  it('serves PDF inline even with a charset parameter on the stored Content-Type', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from('%PDF-1.4')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'a.pdf',
      contentType: 'application/pdf; charset=utf-8',
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
  })

  it('forces HTML attachments to octet-stream + attachment to deny stored XSS', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from('<script>alert(1)</script>')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'evil.html',
      contentType: 'text/html',
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('forces SVG attachments to octet-stream + attachment', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it.each(['', 'not a mime', 'application/we"ird'])(
    'falls back to octet-stream + attachment for malformed stored Content-Type %p',
    async (badType) => {
      await setAuthSession({ id: 'u1', role: 'member' })
      const data = Buffer.from('payload')
      mockFindFirst.mockResolvedValue({
        data,
        filename: 'weird.bin',
        contentType: badType,
      })
      const res = await GET(makeRequest(), mkParams('1'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/octet-stream')
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
    },
  )

  it('always sets X-Content-Type-Options: nosniff and Cache-Control: no-store', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from('payload')
    mockFindFirst.mockResolvedValue({
      data,
      filename: 'a.png',
      contentType: 'image/png',
    })
    const res = await GET(makeRequest(), mkParams('1'))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('emits both legacy filename= and RFC 5987 filename*= for non-ASCII names', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const data = Buffer.from('%PDF-1.4')
    mockFindFirst.mockResolvedValue({
      data,
      filename: '大会要項.pdf',
      contentType: 'application/pdf',
    })
    const res = await GET(makeRequest(), mkParams('1'))
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).toContain('filename="')
    expect(cd).toContain("filename*=UTF-8''")
    expect(cd).toContain(encodeURIComponent('大会要項.pdf'))
  })
})
