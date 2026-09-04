import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entryGroupPaymentReceipts } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'
// node runtime: この route は bytea (Buffer) をそのまま返す。edge runtime は
// pg driver が使えず、bytea を TextEncoder 経由で暗黙変換してしまうため
// images/[token] / attachments/[token] と同じく node を強制する。
export const runtime = 'nodejs'

/**
 * GET /api/line-broadcast/payment-receipts/[token]
 *
 * 支払報告に添えた証憑画像（本体）の公開取得 URL。LINE の画像フェッチャが
 * Cookie 無しで取りに来る先で、`originalContentUrl` としてそのまま渡す
 * (payment-receipt-broadcast 実装手順書 §送信)。
 *
 * middleware.ts の config.matcher は `api/line-broadcast` を否定先読みで
 * 除外済みなので、この route は matcher を触らずに認証を素通りできる。
 * 除外し損ねると全画像がログイン画面へリダイレクトされ、LINE 側は
 * メッセージだけが黙って壊れる（画像が届かない）ことになる。
 *
 * `image-cache.ts`（プロセス内 Map・TTL 24h）は使わない。証憑は記録として
 * 永続保存するので、DB から直接引く。
 */
// images/[token] と同じ形式ガード。生成側は
// `randomBytes(24).toString('base64url')` 相当の URL-safe base64。
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params
  if (!token || !TOKEN_PATTERN.test(token)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const rows = await db
    .select({
      data: entryGroupPaymentReceipts.data,
      contentType: entryGroupPaymentReceipts.contentType,
    })
    .from(entryGroupPaymentReceipts)
    .where(eq(entryGroupPaymentReceipts.token, token))
    .limit(1)
  const hit = rows[0]
  if (!hit) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const headers = new Headers({
    'Content-Type': hit.contentType,
    // LINE はメッセージ送信直後に画像をフェッチしてキャッシュする。images/[token]
    // と同じく短い共有キャッシュで、プレビュー用フェッチと本体フェッチの二重取得を抑える。
    'Cache-Control': 'public, max-age=300, immutable',
  })
  return new NextResponse(new Uint8Array(hit.data), { status: 200, headers })
}
