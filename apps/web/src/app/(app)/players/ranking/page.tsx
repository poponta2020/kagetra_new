import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SectionTabs } from '@/components/stats/section-tabs'
import { getPlayerRanking } from '@/lib/stats/ranking'
import { buildRankingHref, metricDef, parseRankingParams } from './metrics'
import { RankingMetricChips } from './RankingMetricChips'
import { RankingFilterBar } from './RankingFilterBar'
import { RankingList } from './RankingList'

export const dynamic = 'force-dynamic'

/** 収録開始年（design-spec §3.2「収録開始2010」）。期間セレクトの下限。 */
const MIN_YEAR = 2010

/**
 * /players/ranking — ③ 選手ランキング（統計）。design-spec §3.1。
 *
 * 指標チップ（横スクロール）＋1行フィルタ（期間/級・シート）＋順位リスト
 * （TOP100＋もっと見る、行タップ→戦績詳細）。指標・フィルタは searchParams が単一
 * ソースで、変更のたびにサーバー再集計（`getPlayerRanking`）する。優勝/入賞は PR-1 の
 * 事前計算列 derived_bracket を数える。
 */
export default async function PlayerRankingPage({
  searchParams,
}: {
  searchParams: Promise<{
    metric?: string
    yearFrom?: string
    yearTo?: string
    grades?: string
  }>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { metric, filter } = parseRankingParams(await searchParams)
  const { rows, total } = await getPlayerRanking(metric, filter, 100, 0)

  // 期間セレクトの候補：収録開始〜当年（降順）。
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = Math.max(currentYear, MIN_YEAR); y >= MIN_YEAR; y--) years.push(y)

  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-3 p-4">
        <RankingMetricChips metric={metric} filter={filter} />
        <RankingFilterBar metric={metric} filter={filter} years={years} />

        <p className="text-xs text-ink-meta">
          <span className="text-ink">{metricDef(metric).heading}</span>
          {' ・ 全国 ・ 該当 '}
          <span className="text-ink tabular-nums">{total}</span>
          {' 人'}
        </p>

        <RankingList
          key={buildRankingHref(metric, filter)}
          initialRows={rows}
          total={total}
          metric={metric}
          filter={filter}
        />
      </div>
    </div>
  )
}
