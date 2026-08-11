import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * guest-role AC-33: 会員向け受信メールの添付ルートは、ゲストのセッションでは
 * 中身を返さない。
 *
 * このルートは `(app)/` の配下ではないので、画面側のガードでは一切保護されない
 * （requirements §6）。middleware にも許可リストのゲートを置いているが、Edge が
 * 読む JWT の role は降格直後 stale になりうるため、**Node 側のこの判定が実防御**。
 * したがってここでは middleware を通さずハンドラを直接叩いて検証する。
 */

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

const { GET: binaryGet } = await import('./[id]/route')
const { GET: previewGet } = await import('./[id]/preview/[page]/route')

const req = () => new Request('http://localhost:3000/api/mail/attachments/1')

beforeEach(() => {
  mockFindFirst.mockReset()
  mockFindFirst.mockResolvedValue({
    data: Buffer.from('%PDF-1.4 test'),
    filename: 'a.pdf',
    contentType: 'application/pdf',
  })
})

describe('GET /api/mail/attachments/:id', () => {
  it('ゲストは 403 で、添付の中身も DB クエリも発生しない', async () => {
    await setAuthSession({ id: 'g1', role: 'guest' })
    const res = await binaryGet(req(), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('一般会員は従来どおり 200 で取得できる（回帰）', async () => {
    await setAuthSession({ id: 'm1', role: 'member' })
    const res = await binaryGet(req(), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
  })

  it('未認証は従来どおり 401（回帰）', async () => {
    await setAuthSession(null)
    const res = await binaryGet(req(), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/mail/attachments/:id/preview/:page', () => {
  it('ゲストは 403 で、レンダリングにも DB にも到達しない', async () => {
    await setAuthSession({ id: 'g1', role: 'guest' })
    const res = await previewGet(req(), {
      params: Promise.resolve({ id: '1', page: '1' }),
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('未認証は従来どおり 401（回帰）', async () => {
    await setAuthSession(null)
    const res = await previewGet(req(), {
      params: Promise.resolve({ id: '1', page: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('一般会員はゲストのように 403 で弾かれない（回帰）', async () => {
    await setAuthSession({ id: 'm1', role: 'member' })
    const res = await previewGet(req(), {
      params: Promise.resolve({ id: '1', page: '1' }),
    })
    expect(res.status).not.toBe(403)
  })
})
