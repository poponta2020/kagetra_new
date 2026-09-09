import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyLineChatWorkerToken } from '@/lib/line-chat-worker-token'
import { notifyRenewalAdmin } from '@/lib/line-chat-tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MESSAGE_EXCERPT_MAX = 200

/**
 * ワーカーからの `session-warning` body を要点だけの定型文へ整形する。
 *
 * ★**受け取った本文をそのまま横流ししない**（実装手順書の指示）。ワーカーが
 * 送ってくる形は固定されていない（`{ message?: string, ... }` 程度）ため、
 * ここでは `message`（文字列）だけを要点として抜き出し、固定の見出し・注意文と
 * 組み合わせる。OAM のルーム ID・URL 等が紛れていても抜き出さない
 * （ログ規律と同じ理由——外部入力の値をそのまま押し出さない）。
 */
function buildSessionWarningText(body: Record<string, unknown>): string {
  const lines = [
    '⚠️ LINE予約送信ワーカーからセッション警告が届きました',
    'OAM の 30日SSO セッションが失効間近の可能性があります。ワーカーのログを確認し、必要なら手動で再ログインしてください。',
  ]
  if (typeof body.message === 'string' && body.message.trim() !== '') {
    const excerpt = Array.from(body.message.trim()).slice(0, MESSAGE_EXCERPT_MAX).join('')
    lines.push(`ワーカーからの要点: ${excerpt}`)
  }
  return lines.join('\n')
}

/**
 * POST /api/line-chat-worker/session-warning — ワーカーからの OAM セッション
 * 失効先回り警告を管理者個人 LINE へ中継する（requirements R7・R12・R13・
 * implementation-plan「ワーカー契約」・AC-23）。
 *
 * push によるグループへのフォールバック送信はしない。通知先チャネル未設定でも
 * 500 にはしない（`notifyRenewalAdmin` は throw しない契約）。
 */
export async function POST(request: Request): Promise<Response> {
  const verification = verifyLineChatWorkerToken(request.headers.get('x-service-token'))
  if (verification === 'missing') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (verification !== 'ok') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed === 'object' && parsed !== null) {
      raw = parsed as Record<string, unknown>
    }
  } catch {
    // body 無し・不正 JSON でも警告そのものは意味があるので拒否しない
    // （定型文のみで通知する）。
  }

  await notifyRenewalAdmin(db, buildSessionWarningText(raw))
  return NextResponse.json({ ok: true })
}
