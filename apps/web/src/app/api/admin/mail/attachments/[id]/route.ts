import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/mail/attachments/:id
 *
 * Streams a stored mail attachment back to the browser. admin / vice_admin only.
 *
 * Mail attachments are UNTRUSTED user input from the IMAP fetcher: a hostile
 * sender can attach `text/html` or `image/svg+xml` and turn an inline preview
 * into stored XSS on the same origin as the admin UI. Policy (fail-closed
 * allowlist):
 *   - Only the inert preview types below (PDF / Office documents / raster
 *     images / plain text) are served inline with their declared MIME.
 *     Inline is what lets the iOS home-screen PWA preview them via QuickLook:
 *     the standalone in-app browser cannot hand
 *     `Content-Disposition: attachment` to a download manager and dies on a
 *     blank page instead (Issue #138). Desktop browsers download types they
 *     cannot render inline, so nothing regresses there.
 *   - Everything else — active content (html / svg / xml / js …), unknown or
 *     malformed types — is rewritten to `application/octet-stream` and forced
 *     to `Content-Disposition: attachment`. Sender-controlled input cannot be
 *     made safe by enumerating known-bad types, so anything outside the
 *     allowlist fails closed to a download (codex pr139 r2).
 *   - The response Content-Type is therefore always either an allowlist
 *     constant or `application/octet-stream`; the stored value is never
 *     echoed back, so a malformed string can neither break response headers
 *     nor smuggle parameters.
 *   - `X-Content-Type-Options: nosniff` is always set so the browser cannot
 *     override the declared type by sniffing the body.
 *
 * The public `/api/line-broadcast/attachments/[token]` route (PR #70) is
 * stricter still: it pins `attachment` for ALL types because it is
 * unauthenticated and must never render anything same-origin, while this
 * route is admin/vice_admin-gated and prioritizes in-PWA preview.
 *
 * Filenames are RFC 5987-encoded (`filename*=UTF-8''…`) alongside a legacy
 * `filename="…"` so non-ASCII names like "大会要項.pdf" survive proxies that
 * reject 8-bit headers.
 *
 * Refs:
 *   - https://nextjs.org/docs/app/building-your-application/routing/route-handlers
 *   - https://datatracker.ietf.org/doc/html/rfc5987
 *   - https://datatracker.ietf.org/doc/html/rfc6266
 */
const INLINE_ALLOWED_CONTENT_TYPES = new Set<string>([
  // PDF — ブラウザ内蔵ビューア / QuickLook
  'application/pdf',
  'application/x-pdf',
  // Office 文書 — 大会要項・申込書・名簿で実際に届く型。active content では
  // なく、iOS QuickLook がプレビューできる (Issue #138 の本命は .doc/.docx)
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // ラスタ画像のみ (image/svg+xml は active content なので絶対に入れない)
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  // プレーンテキスト — nosniff 前提でテキストとして描画される
  'text/plain',
  'text/csv',
])

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  // Reject anything other than a canonical positive integer string. Drizzle
  // parameterizes the query so SQL injection isn't the concern; the worry is
  // that `Number.parseInt('1.5', 10)` and `Number.parseInt('1e5', 10)` both
  // return `1`, silently mapping unrelated URLs onto the same row.
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: 'Invalid attachment id' }, { status: 400 })
  }
  const attachmentId = Number.parseInt(id, 10)
  // `mail_attachments.id` is Postgres `serial` (int4). Anything beyond
  // 2**31 - 1 cannot exist in the column — reject at the route boundary so
  // pg doesn't raise a runtime "value out of range" 500 for what is really a
  // 400-class input.
  if (attachmentId > 2147483647) {
    return NextResponse.json({ error: 'Invalid attachment id' }, { status: 400 })
  }

  const row = await db.query.mailAttachments.findFirst({
    where: eq(mailAttachments.id, attachmentId),
    columns: {
      data: true,
      filename: true,
      contentType: true,
    },
  })
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Strip parameters (e.g. `; charset=utf-8`) before the allowlist check so
  // `application/pdf; charset=utf-8` still previews. The stored value is
  // never echoed into a response header (the response type is an allowlist
  // constant or octet-stream), so header injection is structurally impossible.
  const declaredContentType = (row.contentType ?? '')
    .toLowerCase()
    .split(';')[0]
    ?.trim() ?? ''
  const allowInline = INLINE_ALLOWED_CONTENT_TYPES.has(declaredContentType)
  const responseContentType = allowInline
    ? declaredContentType
    : 'application/octet-stream'
  const dispositionType = allowInline ? 'inline' : 'attachment'

  const safeAscii = row.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const utf8Encoded = encodeURIComponent(row.filename)
  const disposition = `${dispositionType}; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`

  // pg returns bytea as a Node Buffer (a Uint8Array subclass over an
  // ArrayBufferLike). lib.dom's `BodyInit` insists on a plain
  // `ArrayBuffer`-backed Uint8Array, so we copy the bytes once into a fresh
  // ArrayBuffer-backed view and hand that straight to NextResponse — passing
  // a Blob round-trips bytes through jsdom's UTF-8 path under tests, which
  // truncates on multibyte boundaries.
  //
  // Size is taken from the actual `data` payload, not the `sizeBytes` column.
  // The writer (imap-client) now pins `sizeBytes` to `data.length`, so the
  // two should agree — but we keep the defensive copy here so any historical
  // row written before that fix (or future divergence) cannot RangeError on
  // `copied.set` (column < data) or hang the browser on a zero-padded body
  // (column > data).
  const copied = new Uint8Array(row.data.length)
  copied.set(row.data)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type': responseContentType,
      'Content-Disposition': disposition,
      'Content-Length': row.data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      // Attachments may carry tournament info before approval; do not let
      // browser caches retain them past the auth boundary.
      'Cache-Control': 'no-store',
    },
  })
}
