import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyLineChatWorkerToken } from '@/lib/line-chat-worker-token'
import {
  isLineChatTaskStatus,
  notifyRenewalAdmin,
  reportTaskResult,
  type ReportTaskResultBody,
} from '@/lib/line-chat-tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 未検証の JSON body から必要な形だけ取り出す（過剰なキーは無視する）。 */
interface RawResultBody {
  status?: unknown
  errorCode?: unknown
  errorMessage?: unknown
  mentionResult?: unknown
}

function isMentionResult(
  value: unknown,
): value is { matched: string[]; unmatched: string[] } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.matched) &&
    v.matched.every((x) => typeof x === 'string') &&
    Array.isArray(v.unmatched) &&
    v.unmatched.every((x) => typeof x === 'string')
  )
}

function buildFailureNotificationText(taskId: number, body: ReportTaskResultBody): string {
  const heading =
    body.status === 'FAILED'
      ? `⚠️ 年度確認の LINE 予約送信タスク #${taskId} が失敗しました`
      : `⚠️ 年度確認の LINE 予約送信タスク #${taskId} が要確認になりました`
  const lines = [heading]
  if (body.errorCode) lines.push(`エラーコード: ${body.errorCode}`)
  if (body.errorMessage) lines.push(`理由: ${body.errorMessage}`)
  lines.push('/settings/club-line-group から状態を確認してください。')
  return lines.join('\n')
}

/**
 * POST /api/line-chat-worker/{id}/result — ワーカーからのタスク結果報告
 * （requirements R7・R12・R13・AC-16c・AC-21・AC-23）。
 *
 * 状態遷移の中身（条件付き UPDATE・404/409 の区別）は `reportTaskResult`
 * （lib/line-chat-tasks.ts）が正。ここでは認証・入力の最低限の形検証・
 * `FAILED`/`MANUAL_REVIEW_REQUIRED` 報告時の管理者個人 LINE 通知（AC-23）だけを
 * 行う。push によるグループへのフォールバック送信はしない。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const verification = verifyLineChatWorkerToken(request.headers.get('x-service-token'))
  if (verification === 'missing') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (verification !== 'ok') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })
  }
  const taskId = Number.parseInt(id, 10)

  let raw: RawResultBody
  try {
    raw = (await request.json()) as RawResultBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isLineChatTaskStatus(raw.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  const body: ReportTaskResultBody = {
    status: raw.status,
    errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : null,
    errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : null,
    mentionResult: isMentionResult(raw.mentionResult) ? raw.mentionResult : undefined,
  }

  const outcome = await reportTaskResult(db, taskId, body)
  if ('error' in outcome) {
    const status = outcome.error === 'not_found' ? 404 : 409
    return NextResponse.json({ error: outcome.error }, { status })
  }

  // AC-23: FAILED / MANUAL_REVIEW_REQUIRED の報告時は管理者個人 LINE へ通知する。
  // 通知そのものが失敗しても報告処理自体は成功として扱う（throw しない契約の
  // notifyRenewalAdmin をそのまま使う）。
  if (body.status === 'FAILED' || body.status === 'MANUAL_REVIEW_REQUIRED') {
    await notifyRenewalAdmin(db, buildFailureNotificationText(taskId, body))
  }

  return NextResponse.json({ ok: true })
}
