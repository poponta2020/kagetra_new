'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import type { HeaderField } from '@/lib/entry-form/cell-map'
import { saveEntryFormSettings } from '@/lib/entry-form/settings'

/**
 * entry-form-autofill タスク6: 申込書設定（会の定数6項目）の保存。
 *
 * settings.ts（lib）自体には認可を入れていない（下書き作成=タスク7からも呼ばれるため）。
 * ここ（Server Action）で AC-2（一般会員はアクセス不可）を担保する。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function saveEntryFormSettingsAction(
  values: Record<HeaderField, string>,
): Promise<void> {
  const session = await requireAdminSession()

  const email = values.email?.trim()
  if (email && !EMAIL_RE.test(email)) {
    throw new Error('連絡先 E-Mail の形式が正しくありません')
  }

  await saveEntryFormSettings(values, session.user.id)
  revalidatePath('/settings/entry-form')
}
