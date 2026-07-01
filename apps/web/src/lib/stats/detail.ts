import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { periodConds } from './filters'
import {
  ALL_GRADES,
  coerceDetailMetric,
  sanitizeStatsFilter,
  type DetailMetric,
  type Grade,
  type StatsFilter,
} from './types'
import type { YearCountPoint } from './overview'

/**
 * ④大会統計・図詳細（`/tournaments/stats/[metric]`）のサーバー集計。requirements §3.6 / §4.2、
 * design-spec §3.3。**全級＋各級（A〜E）**を並置して比較する（縦スモールマルチプル）。
 * 期間フィルタのみ・級では絞らない（全級＋各級を常に並べる）。
 *
 * - `score` … 枚数差ヒスト（normal の勝者行で試合を 1 回だけ数える）
 * - `competitors` … 年別 競技人口（distinct player）
 * - `participations` … 年別 大会参加人数（延べ参加）
 *
 * 「全級（all）」は各級の単純合算ではない：competitors は選手が複数級に出ても distinct で
 * 1 人（合算は重複）、participations は grade 無し級も含む（各級 A〜E の和より多くなり得る）。
 * だから all は per-grade とは別に算出する。
 */

/** 系列キー：全級（参照）＋各級。表示順は all→A→…→E。 */
export type SeriesKey = 'all' | Grade

/** 系列の表示順（design-spec §3.3：全級参照を先頭に A〜E）。 */
export const SERIES_KEYS: readonly SeriesKey[] = ['all', ...ALL_GRADES]

/** score 詳細の 1 系列（枚数差ヒスト）。 */
export interface ScoreSeries {
  key: SeriesKey
  /** length 25。index i＝枚数差 (i+1) 枚の試合数。 */
  bins: number[]
  /** 枚数差の平均（データ無しは 0）。 */
  average: number
}

/** competitors / participations 詳細の 1 系列（年推移）。 */
export interface YearSeries {
  key: SeriesKey
  /** 年昇順・データのある年のみ（UI が全級の年域で 0 埋め・軸整列）。 */
  points: YearCountPoint[]
}

export type StatsDetail =
  | { metric: 'score'; series: ScoreSeries[] }
  | { metric: 'competitors'; series: YearSeries[] }
  | { metric: 'participations'; series: YearSeries[] }

const SCORE_BINS = 25

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}

/**
 * getStatsDetail — 図詳細（全級＋各級の比較）。読み取り専用・サーバー集計。metric は
 * 動的セグメント由来なので `coerceDetailMetric` で許可リストへ丸め、期間は
 * `sanitizeStatsFilter`（級は無視）で安全化してから集計する。
 */
export async function getStatsDetail(
  metric: DetailMetric,
  filter: StatsFilter = {},
): Promise<StatsDetail> {
  const safeMetric = coerceDetailMetric(metric)
  const f = sanitizeStatsFilter(filter)
  const period = periodConds(f)

  switch (safeMetric) {
    case 'score':
      return { metric: 'score', series: await queryScoreDetail(period) }
    case 'competitors':
      return { metric: 'competitors', series: await queryCompetitorsDetail(period) }
    case 'participations':
      return { metric: 'participations', series: await queryParticipationsDetail(period) }
  }
}

/** 空の 25 本ビン。 */
function emptyBins(): number[] {
  return new Array<number>(SCORE_BINS).fill(0)
}

/** ビンから平均（試合数で加重）を出す。 */
function averageOfBins(bins: number[]): number {
  let weighted = 0
  let total = 0
  for (let i = 0; i < bins.length; i++) {
    weighted += (i + 1) * bins[i]!
    total += bins[i]!
  }
  return total > 0 ? weighted / total : 0
}

/** score：(grade, diff) の試合数を all＋各級のヒストへ振り分ける。 */
async function queryScoreDetail(
  period: ReturnType<typeof periodConds>,
): Promise<ScoreSeries[]> {
  const res = await db.execute(sql`
    SELECT tc.grade AS grade, m.score_diff::int AS diff, count(*)::int AS cnt
    FROM matches m
    JOIN tournament_classes tc ON tc.id = m.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE m.status = 'normal' AND m.result = 'win'
      AND m.score_diff BETWEEN 1 AND ${SCORE_BINS} ${period}
    GROUP BY tc.grade, diff
  `)
  const binsByKey = new Map<SeriesKey, number[]>()
  for (const key of SERIES_KEYS) binsByKey.set(key, emptyBins())

  for (const row of res.rows as Record<string, unknown>[]) {
    const diff = num(row.diff)
    const cnt = num(row.cnt)
    if (diff < 1 || diff > SCORE_BINS) continue
    // 全級（grade 無し級も含む）。
    const allBins = binsByKey.get('all')!
    allBins[diff - 1] = (allBins[diff - 1] ?? 0) + cnt
    const grade = row.grade == null ? null : (String(row.grade) as Grade)
    if (grade && ALL_GRADES.includes(grade)) {
      const gradeBins = binsByKey.get(grade)!
      gradeBins[diff - 1] = (gradeBins[diff - 1] ?? 0) + cnt
    }
  }

  return SERIES_KEYS.map((key) => {
    const bins = binsByKey.get(key)!
    return { key, bins, average: averageOfBins(bins) }
  })
}

/** 年→count の Map を昇順 points 配列へ。 */
function toPoints(byYear: Map<number, number>): YearCountPoint[] {
  return [...byYear.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year)
}

/**
 * competitors：全級は distinct player の年集計（別クエリ＝級合算だと重複）。各級は
 * (grade, year) の distinct player。
 */
async function queryCompetitorsDetail(
  period: ReturnType<typeof periodConds>,
): Promise<YearSeries[]> {
  const [allRes, gradeRes] = await Promise.all([
    db.execute(sql`
      SELECT extract(year FROM t.event_date)::int AS year,
             count(DISTINCT tp.player_id)::int AS cnt
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tp.player_id IS NOT NULL AND t.event_date IS NOT NULL ${period}
      GROUP BY year
    `),
    db.execute(sql`
      SELECT tc.grade AS grade, extract(year FROM t.event_date)::int AS year,
             count(DISTINCT tp.player_id)::int AS cnt
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tp.player_id IS NOT NULL AND tc.grade IS NOT NULL AND t.event_date IS NOT NULL ${period}
      GROUP BY tc.grade, year
    `),
  ])
  return assembleYearSeries(allRes.rows as Record<string, unknown>[], gradeRes.rows as Record<string, unknown>[])
}

/**
 * participations：延べ参加は加算的なので (grade, year) 1 クエリで済む。all＝年ごとの全行
 * 合算（grade 無し級を含む）、各級＝そのグレードの行。
 */
async function queryParticipationsDetail(
  period: ReturnType<typeof periodConds>,
): Promise<YearSeries[]> {
  const res = await db.execute(sql`
    SELECT tc.grade AS grade, extract(year FROM t.event_date)::int AS year, count(*)::int AS cnt
    FROM tournament_participants tp
    JOIN tournament_classes tc ON tc.id = tp.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE t.event_date IS NOT NULL ${period}
    GROUP BY tc.grade, year
  `)
  const rows = res.rows as Record<string, unknown>[]
  // all＝年ごとに全 grade（null 含む）を合算。
  const allByYear = new Map<number, number>()
  for (const row of rows) {
    const year = num(row.year)
    allByYear.set(year, (allByYear.get(year) ?? 0) + num(row.cnt))
  }
  const allRows = [...allByYear.entries()].map(([year, cnt]) => ({ year, cnt }))
  return assembleYearSeries(allRows, rows)
}

/**
 * all の年集計行と (grade, year) 行から YearSeries[] を all→A〜E の順で組む。
 * 各系列は年昇順・データのある年のみ（0 の年は落とす。UI が全級の年域で軸を整える）。
 */
function assembleYearSeries(
  allRows: Record<string, unknown>[],
  gradeRows: Record<string, unknown>[],
): YearSeries[] {
  const allByYear = new Map<number, number>()
  for (const row of allRows) allByYear.set(num(row.year), num(row.cnt))

  const byGrade = new Map<Grade, Map<number, number>>()
  for (const g of ALL_GRADES) byGrade.set(g, new Map())
  for (const row of gradeRows) {
    const grade = row.grade == null ? null : (String(row.grade) as Grade)
    if (grade && ALL_GRADES.includes(grade)) {
      byGrade.get(grade)!.set(num(row.year), num(row.cnt))
    }
  }

  return SERIES_KEYS.map((key) => ({
    key,
    points: toPoints(key === 'all' ? allByYear : byGrade.get(key)!),
  }))
}
