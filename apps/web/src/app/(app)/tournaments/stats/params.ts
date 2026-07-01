import {
  coerceDetailMetric,
  sanitizeStatsFilter,
  type DetailMetric,
  type StatsFilter,
} from '@/lib/stats/types'

/**
 * ④大会統計（`/tournaments/stats` とその図詳細）の searchParams ⇔ フィルタ変換とリンク
 * 組み立て。大会統計は**期間フィルタのみ**（級では絞らない）なので year だけを扱う。純関数の
 * ため client/server 双方から import 可。`coerceDetailMetric` も再エクスポートして
 * ページ側の import を 1 箇所に集約する。
 */
export { coerceDetailMetric }

type RawParam = string | string[] | undefined

function firstParam(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * 期間 searchParams（yearFrom/yearTo）を検証済み StatsFilter に。配列/単値の両方を安全に
 * 丸め、`sanitizeStatsFilter` で妥当な年のみ採用（不正は捨てる・from>to は入替）。級は扱わない。
 */
export function parsePeriodParams(sp: {
  yearFrom?: RawParam
  yearTo?: RawParam
}): StatsFilter {
  const candidate: StatsFilter = {}
  const yf = firstParam(sp.yearFrom)
  const yt = firstParam(sp.yearTo)
  if (yf != null) candidate.yearFrom = Number(yf)
  if (yt != null) candidate.yearTo = Number(yt)
  return sanitizeStatsFilter(candidate)
}

/** base（`/tournaments/stats` 等）に期間フィルタを付けた href（既定値は省略）。 */
export function buildStatsHref(base: string, filter: StatsFilter): string {
  const params = new URLSearchParams()
  if (filter.yearFrom != null) params.set('yearFrom', String(filter.yearFrom))
  if (filter.yearTo != null) params.set('yearTo', String(filter.yearTo))
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** 図詳細の指標カタログ（タイトル・ドリル対象）。 */
export interface DetailMetricDef {
  key: DetailMetric
  /** メイン画面のカード見出し＝詳細画面のタイトル。 */
  title: string
}

export const DETAIL_METRICS: readonly DetailMetricDef[] = [
  { key: 'score', title: 'スコア統計' },
  { key: 'competitors', title: '年別 競技人口' },
  { key: 'participations', title: '年別 大会参加人数' },
]

export function detailMetricTitle(metric: DetailMetric): string {
  return DETAIL_METRICS.find((m) => m.key === metric)?.title ?? DETAIL_METRICS[0]!.title
}

/** 詳細ドリルの href（メインの図 4〜6 の「級別比較 ›」）。 */
export function detailHref(metric: DetailMetric, filter: StatsFilter): string {
  return buildStatsHref(`/tournaments/stats/${metric}`, filter)
}
