import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SectionTabs } from '@/components/stats/section-tabs'
import { getPlayerRanking } from '@/lib/stats/ranking'
import { buildRankingHref, metricDef, parseRankingParams } from './metrics'
import { RankingMetricChips } from './RankingMetricChips'
import { RankingFilterBar } from './RankingFilterBar'
import { RankingList } from './RankingList'
import { isGuestRole } from '@/lib/guest-access'

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
  // Next.js App Router は同名 query 複数指定を配列で渡す（`?grades=A&grades=B`）。
  // parseRankingParams が配列/単値の両方を安全に丸める。
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  // guest-role: ゲストは会員向け画面に入れない（許可リスト。middleware の
  // 早期ゲートに加えた Node 側の実防御 — Edge の JWT role は降格直後 stale
  // になりうる）。requirements R2 / AC-10
  if (isGuestRole(session.user?.role)) redirect('/403')

  // 当年はサーバー時刻で算出し、parse（デフォルト直近5年の注入）と期間セレクト候補で共有する。
  const currentYear = new Date().getFullYear()
  const { metric, filter, explicit } = parseRankingParams(await searchParams, currentYear)
  const { rows, total } = await getPlayerRanking(metric, filter, 100, 0)

  // 期間セレクトの候補：収録開始〜当年（降順）。
  const years: number[] = []
  for (let y = Math.max(currentYear, MIN_YEAR); y >= MIN_YEAR; y--) years.push(y)

  return (
    <div>
      <SectionTabs />

      {/*
        指標チップ・フィルタ行・該当件数を区画ごとタブ直下に固定（選手検索バーと同じ挙動）。
        surface 背景＋下境界＋淡い影で「ヘッダ」を作り、順位リストがその裏に潜って流れる。
        top-11 はタブ（`sticky top-0 h-11`）分のオフセット。z-10 はタブ（z-20）より後ろ・
        本文より前。チップの `-mx-4` フルブリード横スクロールを保つため px-4 を持たせる。
      */}
      <div className="sticky top-11 z-10 flex flex-col gap-3 border-b border-border bg-surface px-4 pb-3 pt-4 shadow-[0_3px_6px_rgba(60,45,20,0.06)]">
        <RankingMetricChips metric={metric} filter={filter} explicit={explicit} />
        <RankingFilterBar metric={metric} filter={filter} years={years} />

        <p className="text-xs text-ink-meta">
          <span className="text-ink">{metricDef(metric).heading}</span>
          {' ・ 全国 ・ 該当 '}
          <span className="text-ink tabular-nums">{total}</span>
          {' 人'}
        </p>
      </div>

      <div className="px-4 pb-4 pt-3">
        <RankingList
          key={buildRankingHref(metric, filter, explicit)}
          initialRows={rows}
          total={total}
          metric={metric}
          filter={filter}
          explicit={explicit}
        />
      </div>
    </div>
  )
}
