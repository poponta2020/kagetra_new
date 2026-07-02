import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SectionTabs } from '@/components/stats/section-tabs'
import { searchPlayers } from '@/lib/players/queries'
import { PlayerSearchForm } from './components/PlayerSearchForm'
import { PlayerResultRow } from './components/PlayerResultRow'

export const dynamic = 'force-dynamic'

/**
 * /players — 選手戦績の検索（全ログインユーザー）＝「統計」タブの① 選手検索。
 *
 * 選手名で部分一致検索 → 候補一覧 → タップで戦績詳細へ。design-spec
 * `player-search-redesign` で密なリスト（方向性A）へリデザイン：各行に現級・最終
 * 出場（年月＋大会名＋結果）・出場大会数を集約し、最終出場が新しい順（現役が上）に
 * 並べる。検索語は ?q= に載せてサーバー側で normalizePlayerName 正規化検索する。
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
  // 「引退の気配」ミュート判定の基準年。全行で同じ現在年を使うため 1 度だけ算出して渡す。
  const nowYear = new Date().getFullYear()

  return (
    <div>
      <SectionTabs />

      {/*
        検索バー：タブ直下に区画ごと固定（design-spec §7-2）。surface 背景＋下境界＋
        淡い影で「バー」を作り、結果リストがその裏に潜って流れる。top-11 はタブ高さ
        （44px）分のオフセット。z-10 はタブ（z-20）より後ろ・本文より前。
      */}
      <div className="sticky top-11 z-10 border-b border-border bg-surface px-3.5 py-[11px] shadow-[0_3px_6px_rgba(60,45,20,0.06)]">
        <PlayerSearchForm initialQuery={query} />
      </div>

      {query === '' ? (
        <p className="px-4 py-8 text-center text-sm text-ink-meta">
          選手名を入力して検索してください。
        </p>
      ) : results.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-meta">
          「{query}」に一致する選手は見つかりませんでした。
        </p>
      ) : (
        <>
          <div className="px-4 pb-[3px] pt-[11px] text-[11.5px] text-ink-meta">
            「{query}」の検索結果{' '}
            <b className="font-display text-[13px] font-bold text-ink-2">{results.length}</b> 件
            （最終出場が新しい順）
          </div>
          <div className="divide-y divide-border-soft pb-1">
            {results.map((p) => (
              <PlayerResultRow key={p.id} player={p} nowYear={nowYear} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
