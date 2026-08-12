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

const { GET } = await import('./route')

function makeRequest(): Request {
  return new Request('http://localhost:3000/api/roster-files/1')
}

const mkParams = (id: string) => ({ params: Promise.resolve({ id }) })

const ADOPTED_ROW = {
  id: 5,
  rosterType: 'confirmed' as const,
  publishedAt: '2026-08-01',
  sourceAttachment: {
    id: 42,
    filename: '確定名簿.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
}

describe('GET /api/roster-files/:id', () => {
  beforeEach(() => {
    mockRosterFileFindFirst.mockReset()
    mockAttachmentFindFirst.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await setAuthSession(null)
    const res = await GET(makeRequest(), mkParams('5'))
    expect(res.status).toBe(401)
    expect(mockRosterFileFindFirst).not.toHaveBeenCalled()
  })

  it('allows plain member role (no role gate — 会員全員が対象)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_ROW)
    mockAttachmentFindFirst.mockResolvedValue({
      data: Buffer.from('PK'),
      filename: '確定名簿.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const res = await GET(makeRequest(), mkParams('5'))
    expect(res.status).toBe(200)
  })

  it.each(['abc', '0', '01', '1.5', '1e5', '-1', ' 1', '1 '])(
    'returns 400 for non-canonical id %p',
    async (badId) => {
      await setAuthSession({ id: 'u1', role: 'member' })
      const res = await GET(makeRequest(), mkParams(badId))
      expect(res.status).toBe(400)
      expect(mockRosterFileFindFirst).not.toHaveBeenCalled()
    },
  )

  it('returns 400 for ids beyond int4 max', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    const res = await GET(makeRequest(), mkParams('999999999999999999999'))
    expect(res.status).toBe(400)
    expect(mockRosterFileFindFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no adoption row (未採用・解除済み)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('99'))
    expect(res.status).toBe(404)
    expect(mockAttachmentFindFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when the adopted attachment row is missing (defensive, CASCADE想定外)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_ROW)
    mockAttachmentFindFirst.mockResolvedValue(undefined)
    const res = await GET(makeRequest(), mkParams('5'))
    expect(res.status).toBe(404)
  })

  it('serves an adopted xlsx inline with its declared MIME (iOS PWA QuickLook)', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_ROW)
    const data = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    mockAttachmentFindFirst.mockResolvedValue({
      data,
      filename: '確定名簿.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const res = await GET(makeRequest(), mkParams('5'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(new Uint8Array(data)))
  })

  it('fails closed to octet-stream + attachment for a type outside the allowlist', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockRosterFileFindFirst.mockResolvedValue({
      ...ADOPTED_ROW,
      sourceAttachment: {
        id: 42,
        filename: 'archive.zip',
        contentType: 'application/zip',
      },
    })
    mockAttachmentFindFirst.mockResolvedValue({
      data: Buffer.from('PK'),
      filename: 'archive.zip',
      contentType: 'application/zip',
    })
    const res = await GET(makeRequest(), mkParams('5'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  // guest-role AC-34: 名簿ファイルは大会詳細の一部としてゲストにも見せると
  // 決めたもの。ここに role ガードを足すと、ゲストの大会詳細で名簿ビューアが
  // 壊れる（許可リストは middleware 側で `/api/roster-files/**` を通している）。
  it('ゲストのセッションでも従来どおり取得できる（AC-34）', async () => {
    await setAuthSession({ id: 'g1', role: 'guest' })
    mockRosterFileFindFirst.mockResolvedValue(ADOPTED_ROW)
    mockAttachmentFindFirst.mockResolvedValue({
      data: Buffer.from('PK'),
      filename: '確定名簿.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const res = await GET(makeRequest(), mkParams('5'))
    expect(res.status).toBe(200)
  })
})
