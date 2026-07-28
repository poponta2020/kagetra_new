import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'
import {
  loadAdoptedRosterFile,
  parseCanonicalRosterFileId,
} from '@/lib/roster-file-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/roster-files/:id
 *
 * roster-file-adoption タスク3: 会員向け名簿ファイルビューアのバイナリ配信
 * route。**ログイン済みの全会員が対象**（role では絞らない — パース済み名簿が
 * 既に氏名・所属を全会員へ表示しているのと同等の扱い。要件 §3.2.5）。
 *
 * `:id` は `tournament_entry_roster_files.id`（採用レコード自身の id。添付
 * id ではない）。採用済みファイルだけを配信する fail-closed 認可は
 * `loadAdoptedRosterFile` が一手に引き受ける（解除・添付削除のどちらでも
 * null → 404）。
 *
 * MIME allowlist / Content-Disposition の判定は
 * `/api/admin/mail/attachments/[id]/route.ts` と**全く同じ規約**（iOS PWA
 * の in-app browser は `Content-Disposition: attachment` をダウンロード
 * マネージャへ渡せず白画面死する — Issue #138。inert な既知のプレビュー可能
 * 型だけ inline、それ以外は `application/octet-stream` + `attachment` へ
 * fail-closed）。判定ロジックが admin route 内にインラインで書かれており
 * 共有 export が無いため、admin route 側を変更せずここに複製している。
 * 判定結果が一致することは route.test.ts が両方の GET を同じ入力で叩いて
 * 突き合わせて固定する。**allowlist を変更するときは両ファイルを同時に
 * 直すこと。**
 */
const INLINE_ALLOWED_CONTENT_TYPES = new Set<string>([
  // PDF — ブラウザ内蔵ビューア / QuickLook
  'application/pdf',
  'application/x-pdf',
  // Office 文書
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

  const { id } = await params
  const rosterFileId = parseCanonicalRosterFileId(id)
  if (rosterFileId === null) {
    return NextResponse.json({ error: 'Invalid roster file id' }, { status: 400 })
  }

  const adopted = await loadAdoptedRosterFile(rosterFileId)
  if (!adopted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const row = await db.query.mailAttachments.findFirst({
    where: eq(mailAttachments.id, adopted.attachment.id),
    columns: {
      data: true,
      filename: true,
      contentType: true,
    },
  })
  if (!row) {
    // ON DELETE CASCADE により通常は起こらない (添付が消えれば採用行も
    // 一緒に消える) が、念のため fail-closed で 404 にする。
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Strip parameters (e.g. `; charset=utf-8`) before the allowlist check —
  // admin route と同じ。stored value をそのままヘッダへ返さないので header
  // injection は構造的に不可能。
  const declaredContentType =
    (row.contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  const allowInline = INLINE_ALLOWED_CONTENT_TYPES.has(declaredContentType)
  const responseContentType = allowInline
    ? declaredContentType
    : 'application/octet-stream'
  const dispositionType = allowInline ? 'inline' : 'attachment'

  const safeAscii = row.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const utf8Encoded = encodeURIComponent(row.filename)
  const disposition = `${dispositionType}; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`

  // pg が bytea を Node Buffer で返す点・NextResponse へは
  // ArrayBuffer-backed の Uint8Array を渡す必要がある点は admin route と
  // 同じ理由でコピーする。
  const copied = new Uint8Array(row.data.length)
  copied.set(row.data)
  return new NextResponse(copied, {
    status: 200,
    headers: {
      'Content-Type': responseContentType,
      'Content-Disposition': disposition,
      'Content-Length': row.data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      // 採用前の情報を含みうる添付と同じく、認可境界を超えてブラウザ
      // キャッシュへ残さない。
      'Cache-Control': 'no-store',
    },
  })
}
