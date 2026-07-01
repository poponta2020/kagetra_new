import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card } from '@/components/ui'
import { StatsPeriodFilter } from '@/components/stats/StatsPeriodFilter'
import { BarChart } from '@/components/stats/charts/BarChart'
import { Histogram } from '@/components/stats/charts/Histogram'
import { denseYears, formatDecimal1, formatInt } from '@/components/stats/charts/chart-utils'
import { getStatsDetail, type ScoreSeries, type YearSeries } from '@/lib/stats/detail'
import { gradeTone, seriesLabel } from '@/lib/stats/grade-tones'
import {
  buildStatsHref,
  coerceDetailMetric,
  detailMetricTitle,
  parsePeriodParams,
} from '../params'

export const dynamic = 'force-dynamic'

const MIN_YEAR = 2010

/**
 * /tournaments/stats/[metric] — ④ 大会統計・図詳細（級別比較）。requirements §3.6・design-spec §3.3。
 *
 * 全級（参照）＋各級（A〜E）を**縦スモールマルチプル**で並べる。縦軸は形状比較のため図ごと
 * 個別正規化（各ミニ図が自分の最大でスケール）。metric = score / competitors / participations。
 * プッシュ表示のため SectionTabs は出さず戻る導線のみ。期間フィルタは有効（級では絞らない）。
 */
export default async function StatsDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ metric: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { metric: rawMetric } = await params
  const metric = coerceDetailMetric(rawMetric)
  const filter = parsePeriodParams(await searchParams)
  const detail = await getStatsDetail(metric, filter)
  const title = detailMetricTitle(metric)

  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = Math.max(currentYear, MIN_YEAR); y >= MIN_YEAR; y--) years.push(y)

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link href={buildStatsHref('/tournaments/stats', filter)} className="text-sm text-brand">
        ‹ 大会統計へ戻る
      </Link>
      <h1 className="font-display text-xl font-bold text-ink">{title}｜級別比較</h1>

      <StatsPeriodFilter basePath={`/tournaments/stats/${metric}`} filter={filter} years={years} />

      <p className="text-xs text-ink-meta">
        全級（参照）と各級（A〜E）を並べて比較します。縦軸は形状比較のため図ごとに個別正規化しています。
      </p>

      <div className="flex flex-col gap-3">
        {detail.metric === 'score'
          ? detail.series.map((s) => <ScorePanel key={s.key} series={s} />)
          : renderYearPanels(detail.series, detail.metric)}
      </div>
    </div>
  )
}

/** competitors / participations：全系列の x（年）を揃えるため 'all' から年域を取り 0 埋め。 */
function renderYearPanels(series: YearSeries[], unit: 'competitors' | 'participations') {
  const allPoints = series.find((s) => s.key === 'all')?.points ?? []
  const lo = allPoints.length ? Math.min(...allPoints.map((p) => p.year)) : undefined
  const hi = allPoints.length ? Math.max(...allPoints.map((p) => p.year)) : undefined
  return series.map((s) => <YearPanel key={s.key} series={s} lo={lo} hi={hi} unit={unit} />)
}

/** 系列スウォッチ＋ラベル＋見出し数値（serif藍）の共通ヘッダ。 */
function PanelHeader({
  tone,
  label,
  headline,
  sub,
}: {
  tone: string
  label: string
  headline: string
  sub?: string
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden
        className="inline-block h-3 w-3 shrink-0 translate-y-0.5 rounded-[2px]"
        style={{ backgroundColor: tone }}
      />
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="ml-auto font-display text-base font-bold text-brand tabular-nums">
        {headline}
      </span>
      {sub ? <span className="text-[11px] text-ink-meta">{sub}</span> : null}
    </div>
  )
}

/** score 詳細の 1 パネル（枚数差ヒスト・個別正規化・平均線）。 */
function ScorePanel({ series }: { series: ScoreSeries }) {
  const total = series.bins.reduce((s, v) => s + v, 0)
  const tone = gradeTone(series.key)
  return (
    <Card className="flex flex-col gap-1.5">
      <PanelHeader
        tone={tone}
        label={seriesLabel(series.key)}
        headline={`平均 ${formatDecimal1(series.average)} 枚`}
        sub={`${formatInt(total)}試合`}
      />
      <Histogram
        bins={series.bins}
        average={series.average}
        color={tone}
        height={120}
        showAverageLabel={false}
        ariaLabel={`${seriesLabel(series.key)}の枚数差ヒストグラム`}
      />
    </Card>
  )
}

/** competitors / participations 詳細の 1 パネル（年推移・個別正規化）。 */
function YearPanel({
  series,
  lo,
  hi,
  unit,
}: {
  series: YearSeries
  lo?: number
  hi?: number
  unit: 'competitors' | 'participations'
}) {
  const data = denseYears(series.points, lo, hi)
  const dataYears = series.points.filter((p) => p.count > 0)
  const mean =
    dataYears.length > 0
      ? dataYears.reduce((s, p) => s + p.count, 0) / dataYears.length
      : 0
  const tone = gradeTone(series.key)
  const unitLabel = unit === 'competitors' ? '人/年' : '/年'
  return (
    <Card className="flex flex-col gap-1.5">
      <PanelHeader
        tone={tone}
        label={seriesLabel(series.key)}
        headline={`平均 ${formatInt(mean)}`}
        sub={unitLabel}
      />
      <BarChart
        data={data}
        color={tone}
        height={120}
        ariaLabel={`${seriesLabel(series.key)}の年推移`}
      />
    </Card>
  )
}
