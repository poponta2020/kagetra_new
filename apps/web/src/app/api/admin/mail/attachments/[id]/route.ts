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
 * into stored XSS on the same origin as the admin UI. Policy (blocklist):
 *   - Known active-content MIMEs (html/xhtml/svg/xml/js) are rewritten to
 *     `application/octet-stream` and forced to `Content-Disposition: attachment`
 *     so the browser downloads instead of executing.
 *   - Everything else (pdf / doc / docx / xlsx / images …) is served INLINE
 *     with its declared MIME. None of these are active content, and inline is
 *     what lets the iOS home-screen PWA preview them via QuickLook: the
 *     standalone in-app browser cannot hand `Content-Disposition: attachment`
 *     to a download manager and dies on a blank page instead (Issue #138).
 *     Desktop browsers download types they cannot render inline, so nothing
 *     regresses there.
 *   - `X-Content-Type-Options: nosniff` is always set so the browser cannot
 *     override the declared type by sniffing the body.
 *
 * This mirrors the blocklist of the public
 * `/api/line-broadcast/attachments/[token]` route (PR #70) with one deliberate
 * difference: that route pins `attachment` for ALL types because it is
 * unauthenticated and must never render anything same-origin, while this route
 * is admin/vice_admin-gated and prioritizes in-PWA preview.
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
 * RFC 6838 token grammar に沿った `type/subtype` 形式の MIME 判定。
 * 制御文字 / 空白 / カンマが混入した stored Content-Type をそのまま
 * ヘッダに乗せると `new NextResponse(..., { headers })` が例外になり
 * 500 を返してしまうため、通らない値は octet-stream + attachment に
 * 落とす (public token route と同じパターン、pr70 r1 should_fix)。
 */
const SAFE_MIME_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i

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

  // Strip parameters (e.g. `; charset=utf-8`) before blocklist comparison so a
  // hostile `text/html; charset=utf-8\r\n…` header can't dodge the rewrite and
  // also can't header-inject — we never echo the raw value back.
  const declaredContentType = (row.contentType ?? '')
    .toLowerCase()
    .split(';')[0]
    ?.trim() ?? ''
  // RFC 6839 structured-syntax suffix: `*/*+xml` (rss+xml / atom+xml /
  // xslt+xml …) は exact match の Set に居なくてもブラウザの XML/XSLT
  // パイプラインに到達し active content を運べる。Content-Type は送信者
  // 制御なので、suffix 一致でまとめて強制ダウンロードに落とす (pr139 r1)。
  const isDangerous =
    DANGEROUS_CONTENT_TYPES.has(declaredContentType) ||
    declaredContentType.endsWith('+xml')
  const isValidMime = SAFE_MIME_RE.test(declaredContentType)
  const forceDownload = isDangerous || !isValidMime
  const responseContentType = forceDownload
    ? 'application/octet-stream'
    : declaredContentType
  const dispositionType = forceDownload ? 'attachment' : 'inline'

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
