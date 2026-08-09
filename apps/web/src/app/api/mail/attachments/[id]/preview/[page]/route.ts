import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'
import { RENDER_PAGE_LIMIT } from '@/lib/attachment-image-render'
import {
  detectPreviewKind,
  getCachedPreviewMeta,
  getCachedPreviewPage,
  renderAttachmentPreview,
} from '@/lib/attachment-preview'

export const dynamic = 'force-dynamic'

/**
 * GET /api/mail/attachments/:id/preview/:page
 *
 * Member-facing counterpart of
 * `/api/admin/mail/attachments/:id/preview/:page`. Serves one JPEG page of
 * an attachment's in-app preview (1-based page numbers) to any logged-in
 * member. Like the parent binary route, this is a deliberate copy rather
 * than a shared helper — the admin route must not change as a side effect of
 * this feature (Non-goals §5), and `attachment-route-parity.test.ts` is what
 * keeps the two implementations from drifting apart instead of a shared
 * module.
 *
 * The member attachment viewer (`/mail/attachments/[id]`) renders the pages
 * during its own server render, so the common case here is a cache hit. Even
 * then the row's existence is re-checked (id-only projection): the cache
 * outlives a deleted attachment, and this route must 404 in lockstep with
 * the parent binary route instead of leaking stale bytes. On a miss (process
 * restart, LRU eviction between page load and <img> fetch) the route
 * re-renders from the stored bytea — `force: true` skips the cached meta,
 * because a surviving meta with evicted pages must not short-circuit the
 * re-render. Parallel <img> fetches on a cold cache collapse into one
 * conversion via the in-flight registry in attachment-preview.ts.
 *
 * One member-only guard sits in front of that re-render: if the meta is still
 * cached and says the document has fewer pages than requested, we 404 without
 * converting. Without it, repeatedly asking a 1-page PDF for `preview/30`
 * spawns LibreOffice + pdftoppm on every request — cheap to trigger and open
 * to every member. The admin route intentionally keeps its original shape
 * (Non-goals §5 forbids changing it), so this is a deliberate divergence.
 *
 * Output is always pdftoppm-generated JPEG — inert bytes regardless of how
 * hostile the source attachment is, so unlike the parent route there is no
 * MIME allowlist decision to make here.
 *
 * Authorization is `session.user.id` presence only, mirroring the parent
 * binary route — no role check.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; page: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, page } = await params
  // Canonical positive integer strings only — parseInt would silently map
  // '1.5' / '1e5' / '01' onto unrelated rows (same guard as the parent route).
  if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(page)) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 })
  }
  const attachmentId = Number.parseInt(id, 10)
  if (attachmentId > 2147483647) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 })
  }
  const pageNo = Number.parseInt(page, 10)
  // Pages beyond the render cap can never exist; reject before touching the
  // cache or the DB.
  if (pageNo > RENDER_PAGE_LIMIT) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 })
  }

  let cached = getCachedPreviewPage(attachmentId, pageNo)
  if (cached) {
    // キャッシュは添付削除を知らない。行が消えた後も TTL/再起動までは旧バイ
    // トが残るので、ヒット時も bytea を読まない軽量投影で存在確認し、親バイ
    // ナリルートと同じく 404 に揃える（admin ルートと同じ判断）。
    const exists = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachmentId),
      columns: { id: true },
    })
    if (!exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } else {
    // ★会員ルートだけの追加ガード（codex pr479 final blocker。管理者ルートは
    // Non-goal のため変更しないので、ここは意図的な振る舞いの差である）。
    //
    // メタが残っているのにページだけ無いケースは 2 通りある: (a) LRU がページを
    // 落とした（再生成すべき） (b) そもそも存在しないページ番号を要求された
    // （再生成しても 404 にしかならない）。両者を区別せず下の `force: true` へ
    // 落とすと、1 ページの PDF に `preview/30` を投げ続けるだけで LibreOffice +
    // pdftoppm の子プロセスを毎回起動させられる。会員ルートは約100名へ開放される
    // ので、(b) はここで変換前に打ち切る。
    const knownMeta = getCachedPreviewMeta(attachmentId)
    if (knownMeta && pageNo > knownMeta.pageCount) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const row = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachmentId),
      columns: {
        id: true,
        data: true,
        filename: true,
        contentType: true,
      },
    })
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (detectPreviewKind(row.contentType, row.filename) !== 'document') {
      // Images/text/unknown types have no rendered pages — the viewer never
      // links here for them.
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let meta
    try {
      meta = await renderAttachmentPreview(row, { force: true })
    } catch {
      // Conversion failure (corrupt file, libreoffice unavailable). The
      // viewer page surfaces its own fallback card; for a direct page fetch
      // a 502-ish signal is the honest answer.
      return NextResponse.json(
        { error: 'Preview rendering failed' },
        { status: 502 },
      )
    }
    if (pageNo > meta.pageCount) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    cached = getCachedPreviewPage(attachmentId, pageNo)
    if (!cached) {
      // Rendered fine but already evicted again — only plausible under
      // extreme memory pressure. Treat as a transient failure.
      return NextResponse.json(
        { error: 'Preview rendering failed' },
        { status: 502 },
      )
    }
  }

  // Same defensive copy as the parent route: hand NextResponse a plain
  // ArrayBuffer-backed Uint8Array.
  const copied = new Uint8Array(cached.data.length)
  copied.set(cached.data)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type': cached.contentType,
      'Content-Disposition': `inline; filename="preview-${attachmentId}-${pageNo}.jpg"`,
      'Content-Length': cached.data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      // Pre-approval tournament info, same as the parent route — keep it out
      // of browser caches past the auth boundary.
      'Cache-Control': 'no-store',
    },
  })
}
