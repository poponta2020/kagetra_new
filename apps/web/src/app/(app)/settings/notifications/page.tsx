import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui'
import { NotificationSettings } from './NotificationSettings'

/**
 * /settings/notifications — mail-triage-badge: メール通知（Web Push）の購読設定。
 *
 * 新着メール時に端末へ通知し、未処理件数をアプリアイコンのバッジに表示する。
 * 購読は端末ごと。対象は admin / vice_admin（メール処理を担う層）。
 */
export const dynamic = 'force-dynamic'

export default async function NotificationSettingsPage() {
  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink">メール通知</h1>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm text-ink-2">
            <p>
              新着メールを端末に通知し、未処理メール件数をアプリアイコンのバッジに表示します。
            </p>
            <p className="text-xs text-ink-meta">
              iPhone はホーム画面に追加したアプリ（PWA）から開き、通知を許可すると有効になります。
              端末ごとに設定が必要です。
            </p>
          </div>
          <NotificationSettings />
        </div>
      </Card>
    </div>
  )
}
