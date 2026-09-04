import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entryGroupPaymentReceipts } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'
// node runtime: 本体 route (../route.ts) と同じ理由。bytea をそのまま返す。
export const runtime = 'nodejs'

/**
 * GET /api/line-broadcast/payment-receipts/[token]/preview
 *
 * 証憑画像のプレビュー（縮小版）を返す。LINE の `previewImageUrl` と、
 * 管理画面の履歴サムネ表示の両方から使う。プレビューは常に JPEG で
 * 生成されるので Content-Type は固定でよい（本体 route と違い contentType
 * 列を見ない）。
 */
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
      previewData: entryGroupPaymentReceipts.previewData,
    })
    .from(entryGroupPaymentReceipts)
    .where(eq(entryGroupPaymentReceipts.token, token))
    .limit(1)
  const hit = rows[0]
  if (!hit) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const headers = new Headers({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=300, immutable',
  })
  return new NextResponse(new Uint8Array(hit.previewData), {
    status: 200,
    headers,
  })
}
