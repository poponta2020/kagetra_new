import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  attachmentShareTokens,
  mailAttachments,
} from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'
// node runtime: this route returns bytea (Buffer), which the edge runtime
// would silently coerce through TextEncoder. Force Node so binary stays
// binary, and so the `pg` driver is available.
export const runtime = 'nodejs'

/**
 * GET /api/line-broadcast/attachments/[token]
 *
 * Public 60-day download endpoint for mail attachments that we forwarded to
 * a LINE group via signed URL (Excel files, image-render failures, page-cap
 * fallbacks). No authentication: LINE groups include non-account guests
 * (away-team supporters, etc.) who still legitimately need the file.
 *
 * Security model:
 *   - Token is 32 chars URL-safe base64 ≈ 190 bits, effectively unguessable.
 *   - Expiry is enforced server-side (`expires_at > now()`); even with a
 *     leaked token, the window is 60 days.
 *   - access_count is incremented but advisory-only — no rate limiting yet.
 *     If we see abuse, we add a per-token rate limit before introducing auth.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params
  if (!token || token.length < 16 || token.length > 64) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const rows = await db
    .select({
      tokenId: attachmentShareTokens.id,
      mailAttachmentId: attachmentShareTokens.mailAttachmentId,
      filename: mailAttachments.filename,
      contentType: mailAttachments.contentType,
      data: mailAttachments.data,
    })
    .from(attachmentShareTokens)
    .innerJoin(
      mailAttachments,
      eq(mailAttachments.id, attachmentShareTokens.mailAttachmentId),
    )
    .where(
      and(
        eq(attachmentShareTokens.token, token),
        gt(attachmentShareTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)
  const hit = rows[0]
  if (!hit) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // Best-effort access counter — failures here must not block the download.
  // The counter is advisory (abuse detection), so a missed increment is
  // strictly less harmful than a 500.
  void db
    .update(attachmentShareTokens)
    .set({ accessCount: sql`${attachmentShareTokens.accessCount} + 1` })
    .where(eq(attachmentShareTokens.id, hit.tokenId))
    .catch(() => {})

  // RFC 6266 / RFC 5987 escaping for non-ASCII filenames. LINE renders the
  // browser hint after a tap, so a Japanese .pdf filename should survive.
  const safeFilename = encodeURIComponent(hit.filename)
  const headers = new Headers({
    'Content-Type': hit.contentType,
    // `inline` so PDFs / images preview in the browser; the user can still
    // save them. `attachment` would force a download for everything, less
    // friendly for the supporters-following-along case.
    'Content-Disposition': `inline; filename*=UTF-8''${safeFilename}`,
    'Cache-Control': 'private, max-age=300',
  })
  // Convert Node Buffer → Uint8Array for the Web Response stream.
  return new NextResponse(new Uint8Array(hit.data), { status: 200, headers })
}
