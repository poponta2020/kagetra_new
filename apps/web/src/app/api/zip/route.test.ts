import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function reqFor(zipcode: string | null): NextRequest {
  const url = new URL('http://localhost/api/zip')
  if (zipcode !== null) url.searchParams.set('zipcode', zipcode)
  return new NextRequest(url)
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response
}

describe('GET /api/zip', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('成功: zipcloud の address1+2+3 を結合して返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        status: 200,
        message: null,
        results: [
          { address1: '北海道', address2: '札幌市北区', address3: '北十条西' },
        ],
      }),
    )

    const res = await GET(reqFor('0010010'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: '北海道札幌市北区北十条西' })
    // 7-digit normalized code is forwarded to zipcloud.
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('zipcode=0010010'),
      expect.anything(),
    )
  })

  it('ハイフン入り7桁を正規化して照会する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        status: 200,
        message: null,
        results: [{ address1: '東京都', address2: '千代田区', address3: '千代田' }],
      }),
    )

    const res = await GET(reqFor('100-0001'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: '東京都千代田区千代田' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('zipcode=1000001'),
      expect.anything(),
    )
  })

  it('7桁でない入力は照会せず 400', async () => {
    const res = await GET(reqFor('123'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.any(String) })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('zipcode 未指定は 400', async () => {
    const res = await GET(reqFor(null))
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('該当なし(results=null)は 404 で手入力フォールバック', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: 200, message: null, results: null }),
    )

    const res = await GET(reqFor('9999999'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('手入力') })
  })

  it('上流 HTTP エラーは 502 で手入力フォールバック', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false))

    const res = await GET(reqFor('1000001'))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('手入力') })
  })

  it('上流が落ちている(fetch throw)は 502 で手入力フォールバック', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    const res = await GET(reqFor('1000001'))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('手入力') })
  })
})
