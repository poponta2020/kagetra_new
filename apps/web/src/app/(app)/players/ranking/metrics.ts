import type { RankingMetric } from '@/lib/stats/ranking'
import type { Grade, StatsFilter } from '@/lib/stats/types'

/**
 * ③選手ランキングの指標カタログ（design-spec §3.1 の並び：出場／勝利／勝率／対戦／優勝／入賞）。
 * `chip`＝指標チップの短ラベル・`heading`＝見出しの正式名・`unit`＝値の単位。
 *
 * 型のみ `@/lib/stats/ranking` から借りる（`import type` はビルド時に消えるので、
 * db を含むサーバーモジュールがクライアントバンドルに混ざらない）。このモジュール自体は
 * 純粋な定数/関数だけなのでクライアントからも安全に import できる。
 */
export interface MetricDef {
  key: RankingMetric
  chip: string
  heading: string
  unit: string
}

export const RANKING_METRICS: readonly MetricDef[] = [
  { key: 'participations', chip: '出場', heading: '出場回数', unit: '大会' },
  { key: 'wins', chip: '勝利', heading: '勝利数', unit: '勝' },
  { key: 'winRate', chip: '勝率', heading: '勝率', unit: '%' },
  { key: 'matches', chip: '対戦', heading: '対戦数', unit: '戦' },
  { key: 'championships', chip: '優勝', heading: '優勝回数', unit: '回' },
  { key: 'nyusho', chip: '入賞', heading: '入賞回数', unit: '回' },
]

const METRIC_KEYS = RANKING_METRICS.map((m) => m.key)
const DEFAULT_METRIC: RankingMetric = 'participations'
const ALL_GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

export function metricDef(metric: RankingMetric): MetricDef {
  return RANKING_METRICS.find((m) => m.key === metric) ?? RANKING_METRICS[0]!
}

/** 指標値＋単位の表示文字列（勝率のみ小数第1位固定）。 */
export function formatMetricValue(metric: RankingMetric, value: number): string {
  return metric === 'winRate' ? value.toFixed(1) : String(value)
}

/** 副次（muted）表示。勝率のみ母数（対戦数）を「N戦」で返し、他は null。 */
export function formatMetricSub(metric: RankingMetric, sub: number | null): string | null {
  if (metric === 'winRate' && sub != null) return `${sub}戦`
  return null
}

/** filter を反映した /players/ranking の href（既定値は省略してURLを短く保つ）。 */
export function buildRankingHref(metric: RankingMetric, filter: StatsFilter): string {
  const params = new URLSearchParams()
  if (metric !== DEFAULT_METRIC) params.set('metric', metric)
  if (filter.yearFrom != null) params.set('yearFrom', String(filter.yearFrom))
  if (filter.yearTo != null) params.set('yearTo', String(filter.yearTo))
  if (filter.grades && filter.grades.length > 0) {
    // 級は正規順（A→E）で安定化。
    params.set('grades', ALL_GRADES.filter((g) => filter.grades!.includes(g)).join(','))
  }
  const qs = params.toString()
  return qs ? `/players/ranking?${qs}` : '/players/ranking'
}

/** 年の searchParam を検証（数値・妥当な範囲のみ採用、他は undefined）。 */
function parseYear(raw: string | undefined): number | undefined {
  if (raw == null) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1900 || n > 3000) return undefined
  return n
}

/** grades の searchParam（"A,B"）を検証して正規順の配列に。無効値は捨てる。 */
function parseGrades(raw: string | undefined): Grade[] | undefined {
  if (!raw) return undefined
  const set = new Set(raw.split(','))
  const grades = ALL_GRADES.filter((g) => set.has(g))
  return grades.length > 0 ? grades : undefined
}

/**
 * /players/ranking の searchParams を検証済みの `{ metric, filter }` に。
 * 不正な指標/年/級は既定（出場・フィルタ無し）に落とす。yearFrom>yearTo は入替。
 */
export function parseRankingParams(sp: {
  metric?: string
  yearFrom?: string
  yearTo?: string
  grades?: string
}): { metric: RankingMetric; filter: StatsFilter } {
  const metric = (METRIC_KEYS as string[]).includes(sp.metric ?? '')
    ? (sp.metric as RankingMetric)
    : DEFAULT_METRIC

  let yearFrom = parseYear(sp.yearFrom)
  let yearTo = parseYear(sp.yearTo)
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    ;[yearFrom, yearTo] = [yearTo, yearFrom]
  }

  const filter: StatsFilter = {}
  if (yearFrom != null) filter.yearFrom = yearFrom
  if (yearTo != null) filter.yearTo = yearTo
  const grades = parseGrades(sp.grades)
  if (grades) filter.grades = grades

  return { metric, filter }
}
