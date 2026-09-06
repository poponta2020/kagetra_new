import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { travelReportDocuments } from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/travel-reports/[id]
 *
 * 生成済みの遠征届 docx のダウンロード（requirements R9・AC-27）。
 * **提出権限者のみ**（副連絡責任者・管理者・副管理者）。一般会員・ゲスト・未ログインは
 * 403 — 生成物には全員の電話番号が入るため、公開 URL は作らない（§6）。
 *
 * `template/route.ts` と同じ流儀（RFC 5987 の Content-Disposition・nosniff・no-store）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isTravelReportSubmitter(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const documentId = Number(id)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }

  const [row] = await db
    .select({
      filename: travelReportDocuments.filename,
      docx: travelReportDocuments.docx,
    })
    .from(travelReportDocuments)
    .where(eq(travelReportDocuments.id, documentId))
    .limit(1)
  if (!row) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }

  const safeAscii = row.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const disposition = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`

  // pg の bytea は Node Buffer で返る。lib.dom の BodyInit は素の ArrayBuffer 由来の
  // Uint8Array を要求するのでコピーしてから渡す（既存 route と同じ理由）。
  const copied = new Uint8Array(row.docx.length)
  copied.set(row.docx)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition,
      'Content-Length': row.docx.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
