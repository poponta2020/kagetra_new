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
 * into stored XSS on the same origin as the admin UI. To prevent that:
 *   - Only `application/pdf` (sandboxed by the browser viewer) is allowed to
 *     render inline; everything else is forced to
 *     `Content-Disposition: attachment` with `Content-Type: application/octet-stream`
 *     so the browser downloads instead of executing.
 *   - `X-Content-Type-Options: nosniff` is always set so the browser cannot
 *     override the declared type by sniffing the body.
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
  'application/pdf',
  'application/x-pdf',
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
  const attachmentId = Number.parseInt(id, 10)
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
    return NextResponse.json({ error: 'Invalid attachment id' }, { status: 400 })
  }

  const row = await db.query.mailAttachments.findFirst({
    where: eq(mailAttachments.id, attachmentId),
    columns: {
      data: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
    },
  })
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Strip parameters (e.g. `; charset=utf-8`) before allowlist comparison so a
  // hostile `application/pdf; charset=utf-8\r\n…` header can't slip through and
  // also can't header-inject — we never echo the raw value back.
  const declaredContentType = (row.contentType ?? '')
    .toLowerCase()
    .split(';')[0]
    ?.trim() ?? ''
  const allowInline = INLINE_ALLOWED_CONTENT_TYPES.has(declaredContentType)
  const responseContentType = allowInline ? declaredContentType : 'application/octet-stream'
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
  const copied = new Uint8Array(row.sizeBytes)
  copied.set(row.data)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type': responseContentType,
      'Content-Disposition': disposition,
      'Content-Length': row.sizeBytes.toString(),
      'X-Content-Type-Options': 'nosniff',
      // Attachments may carry tournament info before approval; do not let
      // browser caches retain them past the auth boundary.
      'Cache-Control': 'no-store',
    },
  })
}
