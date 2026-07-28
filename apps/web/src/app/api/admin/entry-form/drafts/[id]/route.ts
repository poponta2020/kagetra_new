import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { entryFormDrafts } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/entry-form/drafts/:id
 *
 * 生成済み申込書 xlsx のダウンロード。admin / vice_admin のみ。
 *
 * AC-17（進行管理からの再ダウンロード）と AC-18（IMAP 失敗時のその場
 * ダウンロード）は同じ `entry_form_drafts.xlsx` を読むので1本の route に
 * まとめる。Server Action の戻り値で Buffer を返すより境界がきれいで、
 * ブラウザのダウンロード機構にそのまま乗る。
 *
 * `mail_attachments` の配信 route と違い中身は当システムが生成したもの
 * （送信者由来の不明な MIME ではない）なので、常に xlsx として
 * `attachment` で返す。inline 表示する用途は無い。
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
  // 正準な正整数文字列だけ受ける。`Number.parseInt('1.5')` と
  // `Number.parseInt('1e5')` がどちらも 1 を返し、無関係な行に化けるため。
  if (!/^[1-9]\d*$/.test(id) || Number.parseInt(id, 10) > 2147483647) {
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 })
  }

  const row = await db.query.entryFormDrafts.findFirst({
    where: eq(entryFormDrafts.id, Number.parseInt(id, 10)),
    columns: { xlsx: true, attachmentFilename: true },
  })
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const safeAscii = row.attachmentFilename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const disposition = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(row.attachmentFilename)}`

  // pg の bytea は Node Buffer（ArrayBufferLike 上の Uint8Array）で返るが、
  // lib.dom の BodyInit は素の ArrayBuffer 由来の Uint8Array を要求するため
  // 一度だけコピーして渡す（mail attachments の route と同じ理由）。
  const copied = new Uint8Array(row.xlsx.length)
  copied.set(row.xlsx)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': disposition,
      'Content-Length': row.xlsx.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
