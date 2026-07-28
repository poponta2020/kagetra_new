import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'
import { RENDER_PAGE_LIMIT } from '@/lib/attachment-image-render'
import {
  detectPreviewKind,
  getCachedPreviewPage,
  renderAttachmentPreview,
} from '@/lib/attachment-preview'
import {
  loadAdoptedRosterFile,
  parseCanonicalRosterFileId,
} from '@/lib/roster-file-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/roster-files/:id/preview/:page
 *
 * roster-file-adoption タスク3: `/api/roster-files/:id` の会員向けページ
 * JPEG 版（1-based）。ログイン済みの全会員が対象、認可は
 * `/api/roster-files/[id]/route.ts` と同じく `loadAdoptedRosterFile`
 * （採用済みでなければ 404）。
 *
 * admin 側 `/api/admin/mail/attachments/[id]/preview/[page]/route.ts` との
 * 違いはキャッシュヒット時の再確認だけ: admin 側はキャッシュが添付削除を
 * 知らないため id-only 投影で存在確認してから返す。こちらは
 * `loadAdoptedRosterFile` を**毎リクエスト非キャッシュで**呼ぶ設計で、
 * かつ `sourceAttachmentId` は添付への ON DELETE CASCADE なので、添付が
 * 削除されていれば採用行ごと消えて `loadAdoptedRosterFile` が既に null を
 * 返す — 二重チェックは不要。
 *
 * 出力は常に pdftoppm 生成 JPEG なので、admin 側と同じく MIME allowlist の
 * 判断はここには無い（出力バイト列は元ファイルの種別に関わらず inert）。
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
  const rosterFileId = parseCanonicalRosterFileId(id)
  // page は既存 admin route と同じ正準整数チェックのみ（int4 max は
  // RENDER_PAGE_LIMIT のほうがずっと小さく先に弾かれるので不要）。
  if (rosterFileId === null || !/^[1-9]\d*$/.test(page)) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 })
  }
  const pageNo = Number.parseInt(page, 10)
  if (pageNo > RENDER_PAGE_LIMIT) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 })
  }

  const adopted = await loadAdoptedRosterFile(rosterFileId)
  if (!adopted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const attachmentId = adopted.attachment.id

  let cached = getCachedPreviewPage(attachmentId, pageNo)
  if (!cached) {
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
      // ON DELETE CASCADE のため通常は起こらない（起こるなら
      // loadAdoptedRosterFile が既に null を返している）が、念のため
      // fail-closed。
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (detectPreviewKind(row.contentType, row.filename) !== 'document') {
      // 画像/テキスト/変換不能な種別にはページ画像が無い。ビューアページは
      // それらの種別にはこの route へリンクしない。
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let meta
    try {
      meta = await renderAttachmentPreview(row, { force: true })
    } catch {
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
      return NextResponse.json(
        { error: 'Preview rendering failed' },
        { status: 502 },
      )
    }
  }

  const copied = new Uint8Array(cached.data.length)
  copied.set(cached.data)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type': cached.contentType,
      'Content-Disposition': `inline; filename="preview-${attachmentId}-${pageNo}.jpg"`,
      'Content-Length': cached.data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
