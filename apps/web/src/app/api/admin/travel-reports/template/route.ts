import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import { travelReportTemplateBuffer } from '@/lib/travel-report/docx/template.b64'

export const dynamic = 'force-dynamic'

const FILENAME = '遠征届（原本）.dotx'

/**
 * GET /api/admin/travel-reports/template
 *
 * 同梱テンプレ（クリーン版 .dotx。団体代表者・顧問教員・電話を空欄にした版）の
 * 原本ダウンロード（requirements R11・AC-29）。**提出権限者のみ**
 * （副連絡責任者・管理者・副管理者）。一般会員・ゲスト・未ログインは 403。
 *
 * `apps/web/src/app/api/admin/entry-form/drafts/[id]/route.ts` と同じ流儀
 * （RFC 5987 の Content-Disposition・`X-Content-Type-Options`・
 * `Cache-Control: no-store`）を踏襲するが、こちらは DB 行を持たない
 * 静的な同梱バイト列を返すだけなので id パラメータは無い。
 */
export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isTravelReportSubmitter(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const buffer = travelReportTemplateBuffer()
  const safeAscii = FILENAME.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const disposition = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(FILENAME)}`

  // pg の bytea 由来ではないが、mail attachments / entry-form drafts の各 route と
  // 同じ理由（Node Buffer は lib.dom の BodyInit が要求する素の ArrayBuffer 由来の
  // Uint8Array ではない）でコピーしてから渡す。
  const copied = new Uint8Array(buffer.length)
  copied.set(buffer)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
      'Content-Disposition': disposition,
      'Content-Length': buffer.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
