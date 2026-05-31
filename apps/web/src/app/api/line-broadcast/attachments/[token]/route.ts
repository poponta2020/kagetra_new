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
 * Mail attachments are untrusted user input from the IMAP fetcher. A
 * hostile sender can attach `text/html` or `image/svg+xml` and turn an
 * inline preview into stored XSS on `new.hokudaicarta.com`.
 *
 * Policy:
 *   - Disposition は常に `attachment` (inline 表示を完全に禁止)。これで
 *     active content (html/svg) もブラウザは「ダウンロードして開く」扱い
 *     になり、同一オリジンでのスクリプト実行は起きない。
 *   - 既知の active content MIME (html/svg/xhtml/xml) は
 *     `application/octet-stream` に書き換えて、ブラウザの helper apps が
 *     スクリプト実行可能な形で開くのも防ぐ。
 *   - 上記以外 (xlsx/docx/pdf/jpeg/png 等) は元 MIME のまま返す。LINE 内
 *     ブラウザや OS の関連付け (Excel.app / Numbers / Adobe Reader) が
 *     正しく動作する。
 *   - `X-Content-Type-Options: nosniff` は常に付与。MIME を見ずに body
 *     からタイプを推測する誤動作を遮断。
 *
 * Refs:
 *   - https://datatracker.ietf.org/doc/html/rfc6266
 */
const DANGEROUS_CONTENT_TYPES = new Set<string>([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/svg+xml',
  'text/xml',
  'application/xml',
  // application/javascript / text/javascript も念のため
  'application/javascript',
  'text/javascript',
])

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
// Token は randomBytes(24).toString('base64url') = 32 文字。許容幅は
// 16-64 文字 + URL-safe base64 文字種に限定 (r-final-5 と同パターン)。
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

  // r-final-2 blocker: text/html / image/svg+xml の inline 配信は同一
  // オリジン XSS になる。disposition は常に attachment で防御し、active
  // content MIME のみ octet-stream に書き換える。それ以外 (xlsx/docx/
  // pdf/jpeg 等) は元 MIME を保持して、LINE 内ブラウザや OS の関連付け
  // が正しく動作するようにする (旧実装は xlsx も octet-stream にして
  // しまい、LINE モバイル端末で「ダウンロード後に開けない」になっていた)。
  const declaredContentType =
    (hit.contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  const isDangerous = DANGEROUS_CONTENT_TYPES.has(declaredContentType)
  const responseContentType = isDangerous
    ? 'application/octet-stream'
    : declaredContentType || 'application/octet-stream'
  // attachment 固定 = ブラウザ内 inline 表示を禁止する (XSS 完全遮断)
  const dispositionType = 'attachment'

  // RFC 5987 escaping for non-ASCII filenames. legacy filename= も併記して
  // 8-bit ヘッダを拒否するプロキシを通過させる。
  const safeAscii = hit.filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '')
  const utf8Encoded = encodeURIComponent(hit.filename)
  const disposition = `${dispositionType}; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`

  return new NextResponse(new Uint8Array(hit.data), {
    status: 200,
    headers: {
      'Content-Type': responseContentType,
      'Content-Disposition': disposition,
      'Content-Length': hit.data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      // LINE グループには非ログインゲストも居るので private は不適切。
      // ただし機微情報なので長期キャッシュは避ける (5 分のみ)。
      'Cache-Control': 'public, max-age=300',
    },
  })
}
