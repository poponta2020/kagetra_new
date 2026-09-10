'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import {
  revertClubLineGroup,
  saveClubLineGroup,
  type SaveClubLineGroupInput,
} from '@/lib/club-line-group'
// annual-registration-renewal タスク4（並行実装）が整備するタスク store。
// S3 は「読んで再試行を呼ぶだけ」なので、タスクの作成・遷移ロジックは
// ここへ二重定義しない（実装手順書タスク3の指定）。
import { retryChatTask } from '@/lib/line-chat-tasks'

const SETTINGS_PATH = '/settings/club-line-group'

/**
 * requirements R12: S3 は admin / vice_admin のみ。既存
 * `admin/line-channels/actions.ts` の `requireAdminSession()` と同じ緩さ
 * （vice_admin も通す）を踏襲する。`admin/line-grade-groups` の
 * `requireStrictAdminSession`（admin のみ）とは意図的に別物。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

export async function saveClubLineGroupAction(input: SaveClubLineGroupInput): Promise<void> {
  const session = await requireAdminSession()
  await saveClubLineGroup(input, session.user.id)
  revalidatePath(SETTINGS_PATH)
}

export async function revertClubLineGroupAction(): Promise<void> {
  await requireAdminSession()
  await revertClubLineGroup()
  revalidatePath(SETTINGS_PATH)
}

export async function retryClubLineGroupTaskAction(
  taskId: number,
): Promise<{ error?: string }> {
  await requireAdminSession()
  const result = await retryChatTask(taskId)
  revalidatePath(SETTINGS_PATH)
  return result
}
