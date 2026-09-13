import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { countUnprocessedMails } from '@kagetra/shared/queries'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/mail/unprocessed-count
 *
 * 未処理メール件数を返す。件数は `countUnprocessedMails`（`@kagetra/shared/queries`）
 * が唯一の定義 — 一覧・mail-worker の Web Push badge と共通の述語を使い、取込中の
 * メールを除外する（tournament-results 2026-09-13 改修 タスク3）。
 * PWA のフォアグラウンドバッジ同期（アプリ起動/可視化時、処理操作後の再取得）に使う。
 * admin / vice_admin のみ。
 * mail-inbox-mailer: 2 状態化（unprocessed / processed）に伴い、deferred は廃止。
 */
export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const count = await countUnprocessedMails(db)

  return NextResponse.json({ count })
}
