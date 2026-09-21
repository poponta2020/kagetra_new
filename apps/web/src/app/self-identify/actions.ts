'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth, unstable_update } from '@/auth'
import { claimRosterMember, ROSTER_CLAIM_MESSAGES } from '@/lib/roster-claim'
import type { RosterClaimFormState } from '@/components/register/RosterClaimForm'

/**
 * Self-identify claim: bind the current session's LINE user ID to the
 * selected invited member row, together with the roster-claim「サークル
 * 所属」ブロック（所属チェック・学部区分・学部等名・学年、名簿で空なら
 * 電話・生年月日）。
 *
 * 実処理は `claimRosterMember`（`/register/[token]` と共用）に委譲する。
 * 対象行を `FOR UPDATE` でロックしてから、その行の現在値を根拠に検証し、
 * 明示的に列挙した列だけを更新する（race-safe）。`useActionState` 経由で
 * 呼ばれるため、エラーは redirect ではなく state として返し、フォームの
 * 選択・入力内容を保ったまま再表示できるようにする。
 */
export async function claimMemberIdentity(
  _prev: RosterClaimFormState,
  formData: FormData,
): Promise<RosterClaimFormState> {
  const session = await auth()
  const lineUserId = session?.user?.lineUserId
  if (!lineUserId) redirect('/auth/signin')
  // 既に内部 user.id まで持っている場合、自己申告は不要（middleware が
  // 通常ここに来させないが二重防御）。
  if (session.user?.id) redirect('/')

  const result = await claimRosterMember({ lineUserId, method: 'self_identify', formData })
  if (result.kind === 'unavailable') {
    // 他者 claim / 未招待 / 退会済 etc. 候補の最新状態を再表示させる。
    revalidatePath('/self-identify')
    return { error: ROSTER_CLAIM_MESSAGES.unavailable }
  }
  if (result.kind === 'duplicate') return { error: ROSTER_CLAIM_MESSAGES.duplicate }
  if (result.kind === 'invalid') return { error: result.message }

  try {
    await unstable_update({
      user: {
        lineLinkedAt: result.linkedAt.toISOString(),
        lineLinkedMethod: 'self_identify',
      },
    })
  } catch {
    // JWT refresh 失敗は nodeJwtCallback の次回 Node render で自動回復。
  }

  revalidatePath('/')
  redirect('/')
}
