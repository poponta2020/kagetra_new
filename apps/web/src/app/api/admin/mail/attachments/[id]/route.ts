import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/mail/attachments/:id
 *
 * Streams a stored mail attachment back to the browser (PDF preview, DOCX /
 * XLSX download). admin / vice_admin only — pre-filtered by `auth()` to keep
 * the same gate model that `/admin/mail-inbox` uses on the page side.
 *
 * Two design notes worth preserving as later PRs touch this:
 *   - bytea is materialised into a Node Buffer by the `pg` driver (see
 *     `packages/shared/src/schema/mail-attachments.ts` customType). We pass
 *     it straight to `new NextResponse(Buffer)`; no Uint8Array round-trip.
 *   - Filenames are RFC 5987-encoded (`filename*=UTF-8''…`) alongside a
 *     legacy `filename="…"` so non-ASCII names like "大会要項.pdf" survive
 *     proxies that reject 8-bit headers. Modern browsers prefer the
 *     starred form (Firefox, Chrome, Safari all read it).
 *
 * Refs:
 *   - https://nextjs.org/docs/app/building-your-application/routing/route-handlers
 *   - https://datatracker.ietf.org/doc/html/rfc5987
 */
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

  const safeAscii = row.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const utf8Encoded = encodeURIComponent(row.filename)
  const disposition = `inline; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`

  // pg returns bytea as a Node Buffer (a Uint8Array subclass over an
  // ArrayBufferLike). lib.dom's `BlobPart` and `BodyInit` insist on a
  // plain `ArrayBuffer`-backed Uint8Array, so we copy the bytes once into a
  // fresh ArrayBuffer-backed view. For mail-worker attachments capped at
  // ~30 MB the copy cost is negligible relative to the network egress.
  const copied = new Uint8Array(row.sizeBytes)
  copied.set(row.data)
  const blob = new Blob([copied], { type: row.contentType || 'application/octet-stream' })
  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': row.contentType || 'application/octet-stream',
      'Content-Disposition': disposition,
      'Content-Length': row.sizeBytes.toString(),
      // Attachments may carry tournament info before approval; do not let
      // browser caches retain them past the auth boundary.
      'Cache-Control': 'no-store',
    },
  })
}
