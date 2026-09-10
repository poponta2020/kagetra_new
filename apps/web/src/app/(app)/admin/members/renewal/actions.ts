'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { formEntryOrNull } from '@/lib/member-profile-fields'
import { isRenewalAdmin } from '@/lib/membership-renewal/authz'
import {
  changeRenewalDeadline,
  completeRenewal,
  saveRenewalAnswer,
  startRenewal,
} from '@/lib/membership-renewal/store'

/**
 * S2（`/admin/members/renewal`）の Server Action 群。
 *
 * すべて admin / vice_admin（R12）。`'use server'` の named export は Next.js の
 * RPC として直接到達できるので、**ページ側のガードに依存せず各関数が自分で
 * 認可する**（既存の会員管理 Action と同じ方針）。
 */

async function requireRenewalAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId || !isRenewalAdmin(session?.user?.role)) {
    return { error: 'この操作を行う権限がありません' }
  }
  return { userId }
}

function revalidateRenewalPaths(): void {
  revalidatePath('/admin/members/renewal')
  revalidatePath('/admin/members')
  revalidatePath('/renewal')
  revalidatePath('/dashboard')
  revalidatePath('/settings/club-line-group')
}

// ---------------------------------------------------------------------------
// 開始（R2）
// ---------------------------------------------------------------------------

export type StartRenewalState = { error?: string; success?: boolean }

const fiscalYearSchema = z.coerce.number().int().min(2000).max(2100)

export async function startRenewalAction(
  _prev: StartRenewalState,
  formData: FormData,
): Promise<StartRenewalState> {
  const admin = await requireRenewalAdmin()
  if ('error' in admin) return { error: admin.error }

  const fiscalYear = fiscalYearSchema.safeParse(formEntryOrNull(formData.get('fiscalYear')))
  if (!fiscalYear.success) return { error: '対象年度が不正です' }

  const result = await startRenewal(
    {
      fiscalYear: fiscalYear.data,
      deadline: formEntryOrNull(formData.get('deadline')) ?? '',
      note: formEntryOrNull(formData.get('note')),
    },
    admin.userId,
  )
  if ('error' in result) return { error: result.error }

  revalidateRenewalPaths()
  return { success: true }
}

// ---------------------------------------------------------------------------
// 代理回答（R6・AC-14）
// ---------------------------------------------------------------------------

export type ProxyAnswerState = { error?: string; success?: boolean }

const proxySchema = z.object({
  renewalId: z.coerce.number().int().positive(),
  userId: z.string().min(1),
  answer: z.enum(['register', 'not_register']),
})

/**
 * 管理者が本人に代わって「登録する／登録しない」を記録する。
 * ★**登録情報の修正は行わない**（既存の会員編集で行い、差分は同じ導出で出る。
 * design-spec「代理回答は 2 択だけ」）。したがって `rosterPatch` は渡さない。
 * LINE 未紐付けでログインできない対象者もこの経路で処理できる。
 */
export async function proxyAnswerAction(
  _prev: ProxyAnswerState,
  formData: FormData,
): Promise<ProxyAnswerState> {
  const admin = await requireRenewalAdmin()
  if ('error' in admin) return { error: admin.error }

  const parsed = proxySchema.safeParse({
    renewalId: formEntryOrNull(formData.get('renewalId')),
    userId: formEntryOrNull(formData.get('userId')),
    answer: formEntryOrNull(formData.get('answer')),
  })
  if (!parsed.success) return { error: '入力が不正です' }

  const result = await saveRenewalAnswer({
    renewalId: parsed.data.renewalId,
    userId: parsed.data.userId,
    actorUserId: admin.userId,
    byAdmin: true,
    answer: parsed.data.answer,
  })
  if ('error' in result) return { error: result.error }

  revalidateRenewalPaths()
  return { success: true }
}

// ---------------------------------------------------------------------------
// 締切変更（R8・AC-17）
// ---------------------------------------------------------------------------

export type ChangeDeadlineState = { error?: string; success?: boolean }

const deadlineSchema = z.object({
  renewalId: z.coerce.number().int().positive(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '締切の日付が不正です'),
})

export async function changeDeadlineAction(
  _prev: ChangeDeadlineState,
  formData: FormData,
): Promise<ChangeDeadlineState> {
  const admin = await requireRenewalAdmin()
  if ('error' in admin) return { error: admin.error }

  const parsed = deadlineSchema.safeParse({
    renewalId: formEntryOrNull(formData.get('renewalId')),
    deadline: formEntryOrNull(formData.get('deadline')) ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  const result = await changeRenewalDeadline(parsed.data.renewalId, parsed.data.deadline)
  if ('error' in result) return { error: result.error }

  revalidateRenewalPaths()
  return { success: true }
}

// ---------------------------------------------------------------------------
// 登録完了（R9・AC-18）
// ---------------------------------------------------------------------------

export type CompleteRenewalState = { error?: string; success?: boolean }

const completeSchema = z.object({ renewalId: z.coerce.number().int().positive() })

export async function completeRenewalAction(
  _prev: CompleteRenewalState,
  formData: FormData,
): Promise<CompleteRenewalState> {
  const admin = await requireRenewalAdmin()
  if ('error' in admin) return { error: admin.error }

  const parsed = completeSchema.safeParse({
    renewalId: formEntryOrNull(formData.get('renewalId')),
  })
  if (!parsed.success) return { error: '入力が不正です' }

  const result = await completeRenewal(parsed.data.renewalId, admin.userId)
  if ('error' in result) return { error: result.error }

  revalidateRenewalPaths()
  return { success: true }
}
