import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getEntryFormSettings } from '@/lib/entry-form/settings'
import { EntryFormSettingsForm } from './EntryFormSettingsForm'

/**
 * /settings/entry-form — entry-form-autofill S3: 設定ハブ > 申込書設定。
 *
 * 大会申込書のヘッダ欄（都道府県・所属会名・責任者氏名・電話・E-Mail・振込名義人）と
 * メール本文の署名・差出人に使う会の定数6項目を編集する（requirements §3.2.9）。
 * 管理者・副管理者のみ（Server Action 側=actions.ts でも同じ判定をする）。
 */
export const dynamic = 'force-dynamic'

export default async function EntryFormSettingsPage() {
  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  const settings = await getEntryFormSettings()

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-ink-meta">
          設定 › <b className="text-ink-2">申込書設定</b>
        </p>
        <h1 className="font-display text-xl font-bold text-ink">申込書設定</h1>
        <p className="text-[11px] leading-relaxed text-ink-meta">
          大会申込書のヘッダ欄とメール署名に使う会の情報です。責任者が交代したらここを更新します。
        </p>
      </div>

      <EntryFormSettingsForm initial={settings} />
    </div>
  )
}
