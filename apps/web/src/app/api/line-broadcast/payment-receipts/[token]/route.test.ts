import type { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  entryGroupPaymentReceipts,
  entryGroupPaymentReports,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup } from '@/test-utils/seed'
import { db } from '@/lib/db'
import { GET } from './route'
import { GET as GET_PREVIEW } from './preview/route'

/**
 * GET /api/line-broadcast/payment-receipts/[token]（+ /preview）。
 *
 * LINE の画像フェッチャが Cookie 無しで取りに来る公開取得 URL（AC-6・AC-20）。
 * `image-cache.ts` は使わず、証憑（entry_group_payment_receipts）から直接引く。
 */

const BODY_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x11, 0x22, 0x33])
const PREVIEW_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x99, 0x88])

async function insertReceipt(overrides: {
  entryGroupId?: number
  token: string
  data?: Buffer
  previewData?: Buffer
}) {
  const entryGroupId = overrides.entryGroupId ?? (await createEntryGroup()).id
  const [report] = await testDb
    .insert(entryGroupPaymentReports)
    .values({
      entryGroupId,
      eventIds: [1],
      amountJpy: 12500,
      amountSource: 'payment_notice',
      messageText: '参加費の振り込みが完了しました。',
      receiptCount: 1,
      status: 'sent',
    })
    .returning()
  if (!report) throw new Error('failed to insert payment report')

  const [receipt] = await testDb
    .insert(entryGroupPaymentReceipts)
    .values({
      reportId: report.id,
      sortOrder: 0,
      filename: 'receipt.jpg',
      contentType: 'image/jpeg',
      data: overrides.data ?? BODY_BYTES,
      byteSize: (overrides.data ?? BODY_BYTES).byteLength,
      width: 100,
      height: 200,
      previewData: overrides.previewData ?? PREVIEW_BYTES,
      token: overrides.token,
    })
    .returning()
  if (!receipt) throw new Error('failed to insert payment receipt')
  return receipt
}

// route の GET は NextRequest を受け取るが、この route は req を一切参照しない
// （トークンは params から来る）ので素の Request で足りる。型だけ合わせる。
function makeRequest(): NextRequest {
  return new Request(
    'http://localhost:3000/api/line-broadcast/payment-receipts/x',
  ) as unknown as NextRequest
}

const mkParams = (token: string) => ({ params: Promise.resolve({ token }) })

describe('GET /api/line-broadcast/payment-receipts/[token]', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('正しいトークンで 200・Content-Type: image/jpeg・保存値と一致する本体を返す', async () => {
    const token = 'tok-body-0000000001'
    await insertReceipt({ token })

    const res = await GET(makeRequest(), mkParams(token))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(BODY_BYTES))
  })

  it('preview route は previewData のバイトを返す', async () => {
    const token = 'tok-preview-000000001'
    await insertReceipt({ token })

    const res = await GET_PREVIEW(makeRequest(), mkParams(token))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from(PREVIEW_BYTES))
  })

  it.each(['short', 'has spaces here!!', 'has/slash-in-token-value'])(
    '不正形式のトークン %p は DB を引かずに 404',
    async (badToken) => {
      const selectSpy = vi.spyOn(db, 'select')
      const res = await GET(makeRequest(), mkParams(badToken))
      expect(res.status).toBe(404)
      expect(selectSpy).not.toHaveBeenCalled()
    },
  )

  it('形式は正しいが存在しないトークンは 404', async () => {
    const res = await GET(makeRequest(), mkParams('tok-nonexistent-0000001'))
    expect(res.status).toBe(404)
  })

  it('preview route も存在しないトークンは 404', async () => {
    const res = await GET_PREVIEW(makeRequest(), mkParams('tok-nonexistent-0000002'))
    expect(res.status).toBe(404)
  })

  it('AC-20: 別の証憑のトークンでは当該証憑が取れない（自分のトークンでしか本体が取れない）', async () => {
    const tokenA = 'tok-owner-a-000000001'
    const tokenB = 'tok-owner-b-000000001'
    await insertReceipt({ token: tokenA, data: Buffer.from([0x01, 0x02]) })
    await insertReceipt({ token: tokenB, data: Buffer.from([0x03, 0x04]) })

    const resA = await GET(makeRequest(), mkParams(tokenA))
    const bodyA = new Uint8Array(await resA.arrayBuffer())
    expect(Array.from(bodyA)).toEqual([0x01, 0x02])

    const resB = await GET(makeRequest(), mkParams(tokenB))
    const bodyB = new Uint8Array(await resB.arrayBuffer())
    expect(Array.from(bodyB)).toEqual([0x03, 0x04])

    // token A で取れる内容には token B の証憑データが混入しない。
    expect(Array.from(bodyA)).not.toEqual(Array.from(bodyB))
  })

  it('middleware.ts の config.matcher が api/line-broadcast を除外している（回帰）', () => {
    // next-auth の Edge 初期化をテスト環境で走らせたくないため、`@/middleware` を
    // import せず、ファイルを直接読んで文字列で固定する。この route が matcher の
    // 除外漏れで認証の内側に落ちると、LINE の画像フェッチャは Cookie を送らない
    // ため 全画像がログイン画面へリダイレクトされ、メッセージだけ黙って壊れる。
    const middlewareDir = dirname(fileURLToPath(import.meta.url))
    const middlewarePath = join(middlewareDir, '../../../../../middleware.ts')
    const middlewareSrc = readFileSync(middlewarePath, 'utf-8')
    // matcher 配列の要素（否定先読み正規表現の文字列リテラル）を直接拾う。
    // `matcher: [` の直後にコメント行が複数挟まるため、そこは経由しない。
    const matcherMatch = middlewareSrc.match(/'(\/\(\(\?![^']+)'/)
    expect(matcherMatch).not.toBeNull()
    const matcherPattern = matcherMatch![1]!
    expect(matcherPattern).toContain('api/line-broadcast')
  })
})
