import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import { getTravelReportSettings } from '@/lib/travel-report/settings'
import { TravelReportSettingsForm } from './TravelReportSettingsForm'

/**
 * /settings/travel-report — travel-report（遠征届）S4: 設定ハブ > 遠征届設定。
 *
 * 顧問教員（所属部局等・職・氏名）を編集する。編集できるのは**提出権限者**
 * （副連絡責任者・管理者・副管理者。requirements R2・R12・AC-21）。
 * `lib/travel-report/authz.ts` の唯一のヘルパーで判定する（Server Action
 * 側=actions.ts でも同じ判定をする — ページのガードだけに頼らない）。
 */
export const dynamic = 'force-dynamic'

export default async function TravelReportSettingsPage() {
  const session = await auth()
  if (!session || !(await isTravelReportSubmitter(session))) {
    redirect('/403')
  }

  const settings = await getTravelReportSettings()

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-ink-meta">
          設定 › <b className="text-ink-2">遠征届設定</b>
        </p>
        <h1 className="font-display text-xl font-bold text-ink">遠征届設定</h1>
        <p className="text-[11px] leading-relaxed text-ink-meta">
          遠征届の顧問教員欄に使う情報です。未設定のままでも遠征届は作成でき、
          該当欄が空欄になります。
        </p>
      </div>

      <TravelReportSettingsForm initial={settings} />
    </div>
  )
}
