import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { listAvailableClubChatChannels, loadClubLineGroup } from '@/lib/club-line-group'
import { ClubLineGroupForm } from './ClubLineGroupForm'
import {
  retryClubLineGroupTaskAction,
  revertClubLineGroupAction,
  saveClubLineGroupAction,
} from './actions'

/**
 * /settings/club-line-group — annual-registration-renewal タスク3 S3。
 *
 * 年度確認の案内・リマインドを流す「会 LINE グループ」の設定。
 * admin / vice_admin のみ（requirements R12）。ページ側のガードだけに
 * 頼らず、各 Server Action 側でも同じ判定をする（travel-report と同じ
 * 役割分担）。
 */
export const dynamic = 'force-dynamic'

export default async function ClubLineGroupSettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    redirect('/403')
  }

  const [group, availableChannels] = await Promise.all([
    loadClubLineGroup(),
    listAvailableClubChatChannels(),
  ])

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-ink-meta">
          設定 › <b className="text-ink-2">会 LINE グループ</b>
        </p>
        <h1 className="font-display text-xl font-bold text-ink">会 LINE グループ</h1>
        <p className="text-[11px] text-ink-meta">
          {group
            ? `${group.chatRoomName} ／ Bot: ${group.botLabel}`
            : '年度確認の案内・リマインドを流すグループ'}
        </p>
      </div>

      <ClubLineGroupForm
        initial={group}
        availableChannels={availableChannels}
        saveAction={saveClubLineGroupAction}
        revertAction={revertClubLineGroupAction}
        retryTaskAction={retryClubLineGroupTaskAction}
      />
    </div>
  )
}
