import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { tournamentDrafts } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/mail-inbox/[id]/draft-status
 *
 * mail-inbox-mailer タスク4: ExtractionInProgressCard が 3 秒間隔で叩く軽量
 * polling エンドポイント。`[id]` は **mail_messages.id** の方（mail 詳細画面の URL
 * に合わせる）。
 *
 * 返り値:
 *   - 200 { draft: null }                                  : draft 未作成
 *   - 200 { draft: { status: 'ai_processing' | ... } }     : 現在の draft.status
 *   - 401/403                                              : 認可エラー
 *
 * クライアントは `pending_review` or `ai_failed` を観測したら router.refresh() で
 * Server Component を再取得し、ExtractionInProgressCard が DraftCard / 再試行
 * カードに切り替わる。
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await context.params
  const mailId = Number(id)
  if (!Number.isInteger(mailId) || mailId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const draft = await db
    .select({ status: tournamentDrafts.status })
    .from(tournamentDrafts)
    .where(eq(tournamentDrafts.messageId, mailId))
    .limit(1)

  if (draft.length === 0) {
    return NextResponse.json({ draft: null })
  }
  return NextResponse.json({ draft: { status: draft[0]!.status } })
}
