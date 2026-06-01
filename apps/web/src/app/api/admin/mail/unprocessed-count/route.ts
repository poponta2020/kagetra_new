import { NextResponse } from 'next/server'
import { count, ne } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailMessages } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/mail/unprocessed-count
 *
 * 未処理メール件数（`triage_status != 'processed'` = unprocessed + deferred）を返す。
 * PWA のフォアグラウンドバッジ同期（アプリ起動/可視化時、処理操作後の再取得）に使う。
 * admin / vice_admin のみ。
 */
export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [row] = await db
    .select({ value: count() })
    .from(mailMessages)
    .where(ne(mailMessages.triageStatus, 'processed'))

  return NextResponse.json({ count: row?.value ?? 0 })
}
