import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { periodConds } from './filters'
import { ALL_GRADES, sanitizeStatsFilter, type Grade, type StatsFilter } from './types'

/**
 * ④大会統計・全体サマリー（`/tournaments/stats`）のサーバー集計。requirements §3.6 / §4.2、
 * design-spec §3.2。全級固定・**期間フィルタのみ**（級では絞らない＝級は図内 or 詳細の比較軸）。
 *
 * 用語：**競技人口**＝ユニーク選手数（player_id 非 null の distinct）／**大会参加人数**＝延べ
 * 参加（tournament_participants の行数、未解決 player_id 含む）。
 *
 * 6 図の内訳（うち 1〜3 はこの画面で完結＝詳細なし、4〜6 は `getStatsDetail` へドリル）：
 *   1. 級別構成の推移（年×A〜E の 100% 積み上げ・延べ参加）
 *   2. 新規参入者の推移（初出場年別・**2011〜**＝収録開始 2010 は既存選手を含むため左側打ち切り）
 *   3. 一人当たり 平均年参加数（x=級 A〜E・その人がその年に出た大会数の平均）
 *   4. スコア統計（枚数差 1〜25 の 25 本ヒスト＋平均）
 *   5. 年別 競技人口 ／ 6. 年別 大会参加人数
 */

/** 絶対数カード（4）。全て期間フィルタ適用後の値。 */
export interface StatsTotals {
  /** 競技人口＝distinct player（player_id 非 null）。 */
  competitors: number
  /** 収録大会数＝tournaments 件数（期間指定時は event_date 無しを除外）。 */
  tournaments: number
  /** 総対戦数＝matches 行数（勝者/敗者 2 行のロスレス保持をそのまま数える）。 */
  matches: number
  /** 大会参加人数＝延べ参加（tournament_participants 行数）。 */
  participations: number
}

/** 図1：級別構成の推移。1 年 = 各級（A〜E）の延べ参加。UI で 100% 積み上げに正規化。 */
export interface GradeCompositionPoint {
  year: number
  /** A〜E の延べ参加数（その年にその級が無ければ 0）。 */
  counts: Record<Grade, number>
}

/** 図2/5/6 の年推移 1 点。 */
export interface YearCountPoint {
  year: number
  count: number
}

/** 図3：一人当たり 平均年参加数（級別）。 */
export interface PerPlayerAvgPoint {
  grade: Grade
  /** その級に出た (選手, 年) について「その年に出た大会数」の平均（大会/年）。 */
  avg: number
}

/** 図4：スコア統計（枚数差ヒスト）。 */
export interface ScoreHistogram {
  /** length 25。index i＝枚数差 (i+1) 枚の試合数。 */
  bins: number[]
  /** 枚数差の平均（試合数で加重・小数）。データ無しは 0。 */
  average: number
}

export interface StatsOverview {
  totals: StatsTotals
  /** 図1（年昇順）。 */
  gradeComposition: GradeCompositionPoint[]
  /** 図2（初出場年昇順・2011〜・期間で窓を絞る）。 */
  newcomers: YearCountPoint[]
  /** 図3（A〜E の 5 本・データ無し級は avg=0）。 */
  perPlayerAvg: PerPlayerAvgPoint[]
  /** 図4。 */
  scoreHistogram: ScoreHistogram
  /** 図5（年昇順）。 */
  competitorsByYear: YearCountPoint[]
  /** 図6（年昇順）。 */
  participationsByYear: YearCountPoint[]
}

/** 枚数差ヒストのビン数（1〜25 枚差・design-spec §3.2）。 */
const SCORE_BINS = 25

/** pg の QueryResult 行は Record<string, unknown>。数値列を安全に number へ（bigint 文字列も許容）。 */
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}

/**
 * getStatsOverview — メイン全体サマリー（絶対数4＋6図）。読み取り専用・サーバー集計。
 * 各集計は独立なので Promise.all で並行実行する。信頼できない入力（Server Action・
 * searchParams）でも DB エラー（500）にならないよう choke point で `sanitizeStatsFilter`。
 * 級（grades）は無視する（大会統計は級で絞らない）。
 */
export async function getStatsOverview(filter: StatsFilter = {}): Promise<StatsOverview> {
  const f = sanitizeStatsFilter(filter)
  const period = periodConds(f)

  const [
    totals,
    gradeComposition,
    newcomers,
    perPlayerAvg,
    scoreHistogram,
    competitorsByYear,
    participationsByYear,
  ] = await Promise.all([
    queryTotals(period),
    queryGradeComposition(period),
    queryNewcomers(f),
    queryPerPlayerAvg(period),
    queryScoreHistogram(period),
    queryCompetitorsByYear(period),
    queryParticipationsByYear(period),
  ])

  return {
    totals,
    gradeComposition,
    newcomers,
    perPlayerAvg,
    scoreHistogram,
    competitorsByYear,
    participationsByYear,
  }
}

/** 絶対数カード。competitors/participations は participants 1 パス、matches/tournaments は別。 */
async function queryTotals(period: ReturnType<typeof periodConds>): Promise<StatsTotals> {
  const [participantAgg, matchAgg, tournamentAgg] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*)::int AS participations,
        count(DISTINCT tp.player_id) FILTER (WHERE tp.player_id IS NOT NULL)::int AS competitors
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE true ${period}
    `),
    db.execute(sql`
      SELECT count(*)::int AS n
      FROM matches m
      JOIN tournament_classes tc ON tc.id = m.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE true ${period}
    `),
    db.execute(sql`
      SELECT count(*)::int AS n
      FROM tournaments t
      WHERE true ${period}
    `),
  ])
  const pr = participantAgg.rows[0] ?? {}
  return {
    competitors: num((pr as Record<string, unknown>).competitors),
    participations: num((pr as Record<string, unknown>).participations),
    matches: num((matchAgg.rows[0] as Record<string, unknown> | undefined)?.n),
    tournaments: num((tournamentAgg.rows[0] as Record<string, unknown> | undefined)?.n),
  }
}

/** 図1：年×級の延べ参加を pivot。grade 無し級は除外（構成は A〜E 固定）。 */
async function queryGradeComposition(
  period: ReturnType<typeof periodConds>,
): Promise<GradeCompositionPoint[]> {
  const res = await db.execute(sql`
    SELECT extract(year FROM t.event_date)::int AS year, tc.grade AS grade, count(*)::int AS cnt
    FROM tournament_participants tp
    JOIN tournament_classes tc ON tc.id = tp.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE t.event_date IS NOT NULL AND tc.grade IS NOT NULL ${period}
    GROUP BY year, tc.grade
    ORDER BY year
  `)
  const byYear = new Map<number, GradeCompositionPoint>()
  for (const row of res.rows as Record<string, unknown>[]) {
    const year = num(row.year)
    const grade = String(row.grade) as Grade
    if (!ALL_GRADES.includes(grade)) continue
    let point = byYear.get(year)
    if (!point) {
      point = { year, counts: { A: 0, B: 0, C: 0, D: 0, E: 0 } }
      byYear.set(year, point)
    }
    point.counts[grade] = num(row.cnt)
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

/**
 * 図2：新規参入者。**初出場年は全データで確定**（一人の真のデビュー年）し、その分布を
 * 描く。期間フィルタは表示する年の窓を絞るだけ（部分集合内での「新規」ではない）。
 * 収録開始 2010 年は既存選手を含むため 2011〜（`>= 2011` かつ期間下限）。
 */
async function queryNewcomers(f: StatsFilter): Promise<YearCountPoint[]> {
  // 初出場年サブクエリは period を掛けない（デビュー年は全データ由来）。
  const lo = Math.max(2011, f.yearFrom ?? 2011)
  const hiCond = f.yearTo != null ? sql`AND yr <= ${f.yearTo}` : sql``
  const res = await db.execute(sql`
    SELECT yr AS year, count(*)::int AS cnt
    FROM (
      SELECT tp.player_id, min(extract(year FROM t.event_date))::int AS yr
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tp.player_id IS NOT NULL AND t.event_date IS NOT NULL
      GROUP BY tp.player_id
    ) s
    WHERE yr >= ${lo} ${hiCond}
    GROUP BY yr
    ORDER BY yr
  `)
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    year: num(r.year),
    count: num(r.cnt),
  }))
}

/** 図3：一人当たり 平均年参加数（x=級）。(級, 選手, 年) の distinct 大会数を級で平均。 */
async function queryPerPlayerAvg(
  period: ReturnType<typeof periodConds>,
): Promise<PerPlayerAvgPoint[]> {
  const res = await db.execute(sql`
    SELECT grade, avg(cnt)::float8 AS avg
    FROM (
      SELECT tc.grade AS grade, tp.player_id, extract(year FROM t.event_date)::int AS yr,
             count(DISTINCT t.id)::int AS cnt
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tp.player_id IS NOT NULL AND tc.grade IS NOT NULL AND t.event_date IS NOT NULL ${period}
      GROUP BY tc.grade, tp.player_id, yr
    ) s
    GROUP BY grade
  `)
  const byGrade = new Map<Grade, number>()
  for (const row of res.rows as Record<string, unknown>[]) {
    const grade = String(row.grade) as Grade
    if (ALL_GRADES.includes(grade)) byGrade.set(grade, num(row.avg))
  }
  // A〜E を常に返す（データ無し級は 0）。
  return ALL_GRADES.map((grade) => ({ grade, avg: byGrade.get(grade) ?? 0 }))
}

/** 図4：枚数差ヒスト（1〜25）。試合を 1 回だけ数えるため normal の勝者行のみ集計。 */
async function queryScoreHistogram(
  period: ReturnType<typeof periodConds>,
): Promise<ScoreHistogram> {
  const res = await db.execute(sql`
    SELECT m.score_diff::int AS diff, count(*)::int AS cnt
    FROM matches m
    JOIN tournament_classes tc ON tc.id = m.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE m.status = 'normal' AND m.result = 'win'
      AND m.score_diff BETWEEN 1 AND ${SCORE_BINS} ${period}
    GROUP BY diff
  `)
  const bins = new Array<number>(SCORE_BINS).fill(0)
  let weighted = 0
  let total = 0
  for (const row of res.rows as Record<string, unknown>[]) {
    const diff = num(row.diff)
    const cnt = num(row.cnt)
    if (diff >= 1 && diff <= SCORE_BINS) {
      bins[diff - 1] = cnt
      weighted += diff * cnt
      total += cnt
    }
  }
  return { bins, average: total > 0 ? weighted / total : 0 }
}

/** 図5：年別 競技人口（distinct player）。 */
async function queryCompetitorsByYear(
  period: ReturnType<typeof periodConds>,
): Promise<YearCountPoint[]> {
  const res = await db.execute(sql`
    SELECT extract(year FROM t.event_date)::int AS year,
           count(DISTINCT tp.player_id)::int AS cnt
    FROM tournament_participants tp
    JOIN tournament_classes tc ON tc.id = tp.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE tp.player_id IS NOT NULL AND t.event_date IS NOT NULL ${period}
    GROUP BY year
    ORDER BY year
  `)
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    year: num(r.year),
    count: num(r.cnt),
  }))
}

/** 図6：年別 大会参加人数（延べ参加）。 */
async function queryParticipationsByYear(
  period: ReturnType<typeof periodConds>,
): Promise<YearCountPoint[]> {
  const res = await db.execute(sql`
    SELECT extract(year FROM t.event_date)::int AS year, count(*)::int AS cnt
    FROM tournament_participants tp
    JOIN tournament_classes tc ON tc.id = tp.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE t.event_date IS NOT NULL ${period}
    GROUP BY year
    ORDER BY year
  `)
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    year: num(r.year),
    count: num(r.cnt),
  }))
}
