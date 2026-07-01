import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SectionTabs } from '@/components/stats/section-tabs'
import { Card } from '@/components/ui'
import { StatsPeriodFilter } from '@/components/stats/StatsPeriodFilter'
import { BarChart } from '@/components/stats/charts/BarChart'
import { Histogram } from '@/components/stats/charts/Histogram'
import { GradeLegend, StackedComposition } from '@/components/stats/charts/StackedComposition'
import { denseYears, formatDecimal1, formatInt } from '@/components/stats/charts/chart-utils'
import { getStatsOverview } from '@/lib/stats/overview'
import { GRADE_TONES } from '@/lib/stats/grade-tones'
import { detailHref, parsePeriodParams } from './params'

export const dynamic = 'force-dynamic'

/** 収録開始年（design-spec §3.2「収録開始2010」）。期間セレクトの下限。 */
const MIN_YEAR = 2010

/**
 * /tournaments/stats — ④ 大会統計・全体サマリー（統計）。requirements §3.6・design-spec §3.2。
 *
 * 4 カード＋6 図。全級固定・**期間フィルタのみ**（級は絞り込みでなく比較軸）。図 1〜3 はこの
 * 画面で完結（詳細なし）、図 4〜6 は右上「級別比較 ›」で `/tournaments/stats/<metric>` へドリル。
 * 朱はデータ装飾に使わない（正の強調＝藍・平均線＝中立インク）。
 */
export default async function TournamentStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const filter = parsePeriodParams(await searchParams)
  const ov = await getStatsOverview(filter)

  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = Math.max(currentYear, MIN_YEAR); y >= MIN_YEAR; y--) years.push(y)

  // 図データ：年推移は連続年で 0 埋め・級別は級トーンで着色。
  const newcomers = denseYears(ov.newcomers)
  const competitors = denseYears(ov.competitorsByYear)
  const participations = denseYears(ov.participationsByYear)
  const perPlayerAvg = ov.perPlayerAvg.map((g) => ({
    label: `${g.grade}級`,
    value: g.avg,
    color: GRADE_TONES[g.grade],
  }))

  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <StatsPeriodFilter basePath="/tournaments/stats" filter={filter} years={years} />

        {/* 絶対数カード（大会数／対戦数／競技人口／延べ参加） */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="大会数" value={ov.totals.tournaments} />
          <StatCard label="対戦数" value={ov.totals.matches} />
          <StatCard label="競技人口" value={ov.totals.competitors} unit="人" />
          <StatCard label="延べ参加" value={ov.totals.participations} unit="人" />
        </div>

        {/* 図1：級別構成の推移（完結） */}
        <ChartCard title="級別構成の推移" note="各年を100%に正規化（A〜E）">
          <StackedComposition data={ov.gradeComposition} ariaLabel="級別構成の推移（100%積み上げ）" />
          <GradeLegend className="mt-2 flex flex-wrap gap-x-3 gap-y-1" />
        </ChartCard>

        {/* 図2：新規参入者（完結） */}
        <ChartCard
          title="新規参入者の推移"
          note="初出場年別・2011〜（収録開始2010は既存選手を含むため除外）"
        >
          <BarChart data={newcomers} ariaLabel="新規参入者の推移（初出場年別）" />
        </ChartCard>

        {/* 図3：一人当たり 平均年参加数（x=級・完結） */}
        <ChartCard title="一人当たり 平均年参加数" note="級別・大会/年">
          <BarChart
            data={perPlayerAvg}
            ariaLabel="一人当たり 平均年参加数（級別）"
            valueFormat={formatDecimal1}
          />
        </ChartCard>

        {/* 図4：スコア統計（ドリル） */}
        <ChartCard title="スコア統計" note="枚数差の分布（1〜25枚・平均線）" drill={detailHref('score', filter)}>
          <Histogram
            bins={ov.scoreHistogram.bins}
            average={ov.scoreHistogram.average}
            ariaLabel="スコア統計（枚数差ヒストグラム）"
          />
        </ChartCard>

        {/* 図5：年別 競技人口（ドリル） */}
        <ChartCard title="年別 競技人口" note="各年のユニーク選手数" drill={detailHref('competitors', filter)}>
          <BarChart data={competitors} ariaLabel="年別 競技人口の推移" />
        </ChartCard>

        {/* 図6：年別 大会参加人数（ドリル） */}
        <ChartCard
          title="年別 大会参加人数"
          note="各年の延べ参加"
          drill={detailHref('participations', filter)}
        >
          <BarChart data={participations} ariaLabel="年別 大会参加人数の推移" />
        </ChartCard>
      </div>
    </div>
  )
}

/** 絶対数カード。数値は serif（design-spec §8：大きい数字は Noto Serif JP）。 */
function StatCard({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-ink-meta">{label}</span>
      <span className="font-display text-2xl font-bold text-ink tabular-nums">
        {formatInt(value)}
        {unit ? <span className="ml-0.5 text-sm font-normal text-ink-meta">{unit}</span> : null}
      </span>
    </Card>
  )
}

/** 図カード（見出し＋任意の注記／ドリルリンク＋本体）。 */
function ChartCard({
  title,
  note,
  drill,
  children,
}: {
  title: string
  note?: string
  /** 「級別比較 ›」ドリル先（図 4〜6 のみ）。 */
  drill?: string
  children: ReactNode
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
        {drill ? (
          <Link href={drill} className="shrink-0 text-xs font-medium text-brand">
            級別比較 ›
          </Link>
        ) : null}
      </div>
      {note ? <p className="text-[11px] text-ink-meta">{note}</p> : null}
      {children}
    </Card>
  )
}
