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
import type { DetailMetric } from '@/lib/stats/types'
import {
  buildStatsHref,
  coerceDetailMetric,
  detailMetricTitle,
  parsePeriodParams,
} from '../params'

export const dynamic = 'force-dynamic'

const MIN_YEAR = 2010

/**
 * 指標別の分析文（数え方の説明＋読み取れる傾向）。詳細ページ上部の共通注記の下に添える。
 * 図の内容は指標ごとに異なるため文章も指標単位で持ち、未設定の指標は共通注記のみ表示する。
 */
const METRIC_ANALYSIS: Partial<Record<DetailMetric, string>> = {
  score:
    '各級共に運命戦での決着が一番多い。級毎の比較を行うとE級からB級までは平均枚数差は減少傾向であり、このことから級が上がるにつれ選手間の実力差も小さくなっていくことが予想される。一方でB級→A級では+0.4枚と若干増であり、これはA級には昇級がないため同級であっても実力に差が生じやすいためであると考えられる。枚数差から推測されるに、参加者の中に最も実力差があるのはE級、逆にそれが小さいのはB級である。',
  competitors:
    'グラフはその年に1度以上大会に参加した選手数（＝競技人口）をカウントしたものです。各級のグラフは、その年に最後に出場した級で1人ずつ数えています（1人=1級。同じ年に昇級した選手は昇級後の級のみに数えます）。2020年はコロナ禍の影響で競技人口の落ち込みが顕著ですが、翌年以降は徐々に回復傾向にあることがうかがえます。',
}

/**
 * /tournaments/stats/[metric] — ④ 大会統計・図詳細（級別比較）。requirements §3.6・design-spec §3.3。
 *
 * 全級（参照）＋各級（A〜E）を**縦スモールマルチプル**で並べる。縦軸は score＝全図共通
 * 0〜10% 固定（級間で高さを直接比較）、competitors/participations＝形状比較のため図ごと
 * 個別正規化。metric = score / competitors / participations。
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
  // 不正な metric セグメント（例 /tournaments/stats/bogus）は canonical URL へ正規化
  // リダイレクトする。丸めた metric（score）で表示だけ差し替えると URL が /bogus のまま残り、
  // 戻る導線・期間フィルタ（basePath=canonical）と現在パスが食い違うため（Codex R1 blocker）。
  if (rawMetric !== metric) {
    redirect(buildStatsHref(`/tournaments/stats/${metric}`, filter))
  }
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
        {metric === 'score'
          ? '全級（参照）と各級（A〜E）を並べて比較します。縦軸は全図共通の0〜10%、右軸は累積割合（0〜100%）です。'
          : '全級（参照）と各級（A〜E）を並べて比較します。縦軸は形状比較のため図ごとに個別正規化しています。'}
      </p>
      {METRIC_ANALYSIS[metric] ? (
        <p className="text-xs leading-relaxed text-ink-meta">{METRIC_ANALYSIS[metric]}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {detail.metric === 'score'
          ? detail.series.map((s) => <ScorePanel key={s.key} series={s} />)
          : renderYearPanels(detail.series, detail.metric, currentYear)}
      </div>
    </div>
  )
}

/** competitors / participations：全系列の x（年）を揃えるため 'all' から年域を取り 0 埋め。 */
function renderYearPanels(
  series: YearSeries[],
  unit: 'competitors' | 'participations',
  currentYear: number,
) {
  const allPoints = series.find((s) => s.key === 'all')?.points ?? []
  const lo = allPoints.length ? Math.min(...allPoints.map((p) => p.year)) : undefined
  const hi = allPoints.length ? Math.max(...allPoints.map((p) => p.year)) : undefined
  return series.map((s) => (
    <YearPanel key={s.key} series={s} lo={lo} hi={hi} unit={unit} currentYear={currentYear} />
  ))
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

/** score 詳細の 1 パネル（枚数差パレート図・個別正規化・平均線・累積%右軸）。 */
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
        ariaLabel={`${seriesLabel(series.key)}の枚数差パレート図`}
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
  currentYear,
}: {
  series: YearSeries
  lo?: number
  hi?: number
  unit: 'competitors' | 'participations'
  currentYear: number
}) {
  const data = denseYears(series.points, lo, hi)
  const tone = gradeTone(series.key)
  // 見出しは平均ではなく「今年の人数」。今年のデータが無い級は、その級の最新データ年へ
  // フォールバックして「0名（今年）」を避ける（points は年昇順なので末尾が最新）。
  const latest =
    series.points.find((p) => p.year === currentYear) ??
    series.points[series.points.length - 1]
  const suffix = unit === 'competitors' ? '名' : ''
  const headline = latest
    ? `${formatInt(latest.count)}${suffix}（${latest.year}年）`
    : 'データなし'
  return (
    <Card className="flex flex-col gap-1.5">
      <PanelHeader tone={tone} label={seriesLabel(series.key)} headline={headline} />
      <BarChart
        data={data}
        color={tone}
        height={120}
        ariaLabel={`${seriesLabel(series.key)}の年推移`}
      />
    </Card>
  )
}
