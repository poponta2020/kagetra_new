import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card } from '@/components/ui'
import { SectionTabs } from '@/components/stats/section-tabs'
import { searchPlayers } from '@/lib/players/queries'
import { PlayerSearchForm } from './components/PlayerSearchForm'

export const dynamic = 'force-dynamic'

/**
 * /players — 選手戦績の検索（全ログインユーザー）＝「統計」タブの① 選手検索。
 *
 * 選手名で部分一致検索 → 候補一覧 → タップで戦績詳細へ。senseki-stats PR-2 で
 * `SectionTabs`（4 セクション横断ナビ）配下に収めた（検索ロジックは不変）。
 * 検索語は ?q= に載せてサーバー側で normalizePlayerName 正規化検索する。
 */
export default async function PlayersSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { q } = await searchParams
  const query = (q ?? '').trim()
  const results = query ? await searchPlayers(query) : []

  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <PlayerSearchForm initialQuery={query} />

        {query === '' ? (
          <Card>
            <p className="py-6 text-center text-sm text-ink-meta">
              選手名を入力して検索してください。
            </p>
          </Card>
        ) : results.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-ink-meta">
              「{query}」に一致する選手は見つかりませんでした。
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} className="block">
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {p.displayName}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-meta">
                        {[p.affiliation, p.prefecture]
                          .filter(Boolean)
                          .join(' / ') || '所属不明'}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-ink-meta">
                      {p.participationCount} 大会
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
