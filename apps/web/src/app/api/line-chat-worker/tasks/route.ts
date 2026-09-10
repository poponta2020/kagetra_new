import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyLineChatWorkerToken } from '@/lib/line-chat-worker-token'
import { listWorkerTasks } from '@/lib/line-chat-tasks'

// ビルド時に静的最適化されて DB へ接続しに行かないよう明示的に動的へ固定する
// （`api/external/tournament-entrants/route.ts` と同じ理由）。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/line-chat-worker/tasks — match-tracker `line-chat-worker` 常駐
 * ワーカーがポーリングする未処理タスク一覧（requirements R7・R12、
 * implementation-plan「ワーカー契約」、AC-21・AC-22）。
 *
 * 認証は `X-Service-Token`（`LINE_CHAT_WORKER_TOKEN`）のみ。セッション認証とは
 * 独立の経路で、middleware の matcher から除外されている
 * （`docs/spec/notifications.md` の line-chat-worker 節が正）。
 * トークン無し → 401、不正 → 403（AC-21。区別すること）。
 *
 * 本文の中身（`club_line_groups` 未設定なら空配列・送信予定時刻の margin 除外・
 * `mentions` の後方互換省略）は `listWorkerTasks` の契約どおり
 * （lib/line-chat-tasks.ts）。ここではトークン検証と JSON 化だけを行う。
 */
export async function GET(request: Request): Promise<Response> {
  const verification = verifyLineChatWorkerToken(request.headers.get('x-service-token'))
  if (verification === 'missing') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (verification !== 'ok') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tasks = await listWorkerTasks(db, new Date())
  return NextResponse.json(tasks, { headers: { 'Cache-Control': 'no-store' } })
}
