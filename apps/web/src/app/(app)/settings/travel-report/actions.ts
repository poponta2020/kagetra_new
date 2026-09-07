'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import type { AdvisorField } from '@/lib/travel-report/settings'
import { saveTravelReportSettings } from '@/lib/travel-report/settings'

/**
 * travel-report タスク4: 遠征届設定（顧問教員3項目）の保存。
 *
 * `settings.ts`（lib）自体には認可を入れていない。ここ（Server Action）で
 * `lib/travel-report/authz.ts` の唯一のヘルパーを通し、提出権限者以外を
 * 拒否する（AC-21）。ページ側のガードとは独立に、この Action 単体でも
 * 認可が効くようにする。
 */
async function requireSubmitterSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (!(await isTravelReportSubmitter(session))) throw new Error('Forbidden')
  return session
}

export async function saveTravelReportSettingsAction(
  values: Record<AdvisorField, string>,
): Promise<void> {
  const session = await requireSubmitterSession()

  await saveTravelReportSettings(values, session.user.id)
  revalidatePath('/settings/travel-report')
}
