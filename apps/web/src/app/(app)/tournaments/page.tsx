import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SectionTabs } from '@/components/stats/section-tabs'
import { getTournamentList } from '@/lib/stats/tournaments'
import { TournamentsHeader } from './TournamentsHeader'
import { TournamentYearList } from './TournamentYearList'
import { isGuestRole } from '@/lib/guest-access'

export const dynamic = 'force-dynamic'

/** 年別ビューの初期表示件数（もっと見るで追記）。 */
const PAGE_SIZE = 200

/**
 * /tournaments — ② 大会結果・年別ビュー（閲覧）。requirements §3.4・design-spec §3.4。
 *
 * 全大会を開催日降順・年セクションで一覧（級構成トーンドット＋参加者数、行タップ→大会詳細）。
 * 大会別（`/tournaments/series`）とはヘッダのトグルで切り替え、大会名検索は両ビュー共通。
 */
export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  // guest-role: ゲストは会員向け画面に入れない（許可リスト。middleware の
  // 早期ゲートに加えた Node 側の実防御 — Edge の JWT role は降格直後 stale
  // になりうる）。requirements R2 / AC-10
  if (isGuestRole(session.user?.role)) redirect('/403')

  const sp = await searchParams
  const query = firstParam(sp.q)?.trim() ?? ''
  const { rows, total } = await getTournamentList(query || undefined, undefined, PAGE_SIZE, 0)

  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <TournamentsHeader view="year" query={query} />
        <TournamentYearList key={query} initialRows={rows} total={total} query={query} />
      </div>
    </div>
  )
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
