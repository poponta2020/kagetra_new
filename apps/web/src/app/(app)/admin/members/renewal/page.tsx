import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { todayInJst } from '@/lib/jst-date'
import { resolveRenewalBaseUrl, resolveRenewalPageUrl } from '@/lib/membership-renewal/base-url'
import { isRenewalAdmin } from '@/lib/membership-renewal/authz'
import {
  countRenewalTargets,
  loadCompletionPreview,
  loadLatestRenewal,
  loadOpenRenewal,
  loadRenewalBoard,
} from '@/lib/membership-renewal/store'
import { loadClubLineGroup } from '@/lib/club-line-group'
import { StartForm } from './StartForm'
import { RenewalBoard } from './RenewalBoard'

/**
 * S2 `/admin/members/renewal` — annual-registration-renewal タスク9。
 * admin / vice_admin のみ（requirements R12）。Server Action 側（`actions.ts`）も
 * 自分で同じ判定をするが、ページ側でも到達をガードする（既存の `/admin/**` の流儀）。
 *
 * 3状態（design-spec §5）:
 *   - 未開始: 進行中の年度確認が無い → 開始フォーム
 *   - 進行中: `loadOpenRenewal` が返す年度確認のボード（代理回答・締切変更・登録完了あり）
 *   - 完了後: `?view=result` で直近の完了済み年度確認のボードを読み取り専用表示
 */
export const dynamic = 'force-dynamic'

/** 対象年度の既定値（「翌年度」）。4月始まりの年度なので、1〜3月は今年、4月以降は来年。 */
function suggestNextFiscalYear(todayJst: string): number {
  const [yearStr, monthStr] = todayJst.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  return month >= 4 ? year + 1 : year
}

export default async function RenewalAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')
  if (!isRenewalAdmin(session.user.role)) redirect('/403')

  const { view } = await searchParams

  const openRenewal = await loadOpenRenewal()
  if (openRenewal) {
    const board = await loadRenewalBoard(openRenewal.id)
    if (board) {
      const completionPreview = await loadCompletionPreview(openRenewal.id)
      return <RenewalBoard board={board} mode="open" completionPreview={completionPreview} />
    }
  }

  const latestRenewal = await loadLatestRenewal()
  if (view === 'result' && latestRenewal && latestRenewal.status === 'completed') {
    const board = await loadRenewalBoard(latestRenewal.id)
    if (board) {
      return <RenewalBoard board={board} mode="completed" />
    }
  }

  const [targets, clubLineGroup] = await Promise.all([
    countRenewalTargets(),
    loadClubLineGroup(),
  ])

  return (
    <StartForm
      suggestedFiscalYear={suggestNextFiscalYear(todayInJst())}
      previousRenewal={
        latestRenewal && latestRenewal.status === 'completed'
          ? { fiscalYear: latestRenewal.fiscalYear, completedAt: latestRenewal.completedAt }
          : null
      }
      targets={targets}
      clubLineGroup={
        clubLineGroup ? { chatRoomName: clubLineGroup.chatRoomName, botLabel: clubLineGroup.botLabel } : null
      }
      baseUrlConfigured={resolveRenewalBaseUrl() !== null}
      previewUrl={resolveRenewalPageUrl()}
    />
  )
}
