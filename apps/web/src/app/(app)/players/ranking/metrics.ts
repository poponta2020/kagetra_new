import {
  ALL_GRADES,
  DEFAULT_RANKING_METRIC,
  coerceRankingMetric,
  sanitizeStatsFilter,
  type Grade,
  type RankingMetric,
  type StatsFilter,
} from '@/lib/stats/types'

/**
 * ③選手ランキングの指標カタログ（design-spec §3.1 の並び：出場／勝利／勝率／対戦／優勝／入賞）。
 * `chip`＝指標チップの短ラベル・`heading`＝見出しの正式名・`unit`＝値の単位。
 *
 * 指標の許可リスト/検証・フィルタ検証は `@/lib/stats/types`（db 非依存）に集約し、ここは
 * 表示ラベルと URL 組み立てだけを持つ。すべて純粋な定数/関数なのでクライアントから安全に
 * import できる（サーバー依存を持ち込まない）。
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
  if (metric !== DEFAULT_RANKING_METRIC) params.set('metric', metric)
  if (filter.yearFrom != null) params.set('yearFrom', String(filter.yearFrom))
  if (filter.yearTo != null) params.set('yearTo', String(filter.yearTo))
  if (filter.grades && filter.grades.length > 0) {
    // 級は正規順（A→E）で安定化。
    params.set('grades', ALL_GRADES.filter((g) => filter.grades!.includes(g)).join(','))
  }
  const qs = params.toString()
  return qs ? `/players/ranking?${qs}` : '/players/ranking'
}

/** searchParams の値は Next.js App Router では string だけでなく配列にもなり得る。 */
type RawParam = string | string[] | undefined

/** 配列 searchParam（?k=a&k=b）は先頭を採用。単値/未指定はそのまま。 */
function firstParam(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * /players/ranking の searchParams を検証済みの `{ metric, filter }` に。
 * 指標は許可リストへ丸め、年/級は `sanitizeStatsFilter` で妥当な値のみ採用（不正は捨てる・
 * yearFrom>yearTo は入替）。文字列 → 型付き候補にしてから共通検証へ委譲する。
 *
 * `searchParams` はユーザーが直接改変できる入力で、Next.js は同名 query 複数指定
 * （`?grades=A&grades=B`）を **配列**で渡す。metric/year は先頭を採用、grades は配列・
 * カンマ区切りの両方を平坦化してから検証する（`.split` を配列に対して呼んでページが 500 化
 * するのを防ぐ）。
 */
export function parseRankingParams(sp: {
  metric?: RawParam
  yearFrom?: RawParam
  yearTo?: RawParam
  grades?: RawParam
}): { metric: RankingMetric; filter: StatsFilter } {
  const candidate: StatsFilter = {}
  const yearFrom = firstParam(sp.yearFrom)
  const yearTo = firstParam(sp.yearTo)
  if (yearFrom != null) candidate.yearFrom = Number(yearFrom)
  if (yearTo != null) candidate.yearTo = Number(yearTo)

  const rawGrades = Array.isArray(sp.grades)
    ? sp.grades.flatMap((v) => v.split(','))
    : (sp.grades?.split(',') ?? [])
  if (rawGrades.length > 0) candidate.grades = rawGrades as Grade[]

  return {
    metric: coerceRankingMetric(firstParam(sp.metric)),
    filter: sanitizeStatsFilter(candidate),
  }
}
