/**
 * 統計セクション（③選手ランキング・④大会統計）横断の共通型と、
 * 信頼できない入力（Server Action・searchParams）を安全な値に丸める検証関数。
 * db を持たない純粋モジュールなのでサーバー/クライアント両方から安全に import できる。
 * requirements §3.2 / §4.2。
 */

/** 級（A–E）。tournament_classes.grade（正規化値）に対応。 */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

/** 級の正規順（A→E）。表示・URL の安定化に使う。 */
export const ALL_GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/**
 * 期間・級の横断フィルタ。
 * - `yearFrom` / `yearTo`: `tournaments.event_date` の**年**で絞る（含む・両端任意）。
 *   いずれかを指定すると event_date 無し大会は集計から除外される（日付比較が偽になるため）。
 * - `grades`: 級（複数選択可）。**③選手ランキングのみ**で使用。④大会統計は級で絞らない。
 */
export interface StatsFilter {
  yearFrom?: number
  yearTo?: number
  grades?: Grade[]
  /**
   * ⑤ 昇段済み（現級 ∉ 選択級）の選手も母集団に含めるか。**③選手ランキングのみ**で使用。
   * 未指定=false＝現級のみに絞る。grades 未指定（全級）のときは無効（全員のまま）。
   */
  includeFormerGrade?: boolean
}

/**
 * ③選手ランキングの指標。requirements §3.5。
 * - `participations` 出場回数 ／ `wins` 勝利数（normal の win）／
 *   `winRate` 勝率（最低20試合で足切り）／ `matches` 対戦数（normal の試合数）／
 *   `championships` 優勝回数（derived_bracket=1）／ `nyusho` 入賞回数（derived_bracket≤8）。
 */
export type RankingMetric =
  | 'participations'
  | 'wins'
  | 'winRate'
  | 'matches'
  | 'championships'
  | 'nyusho'

export const RANKING_METRIC_KEYS: readonly RankingMetric[] = [
  'participations',
  'wins',
  'winRate',
  'matches',
  'championships',
  'nyusho',
]

/** 既定指標（不正入力のフォールバック・URL 既定）。 */
export const DEFAULT_RANKING_METRIC: RankingMetric = 'participations'

/**
 * 未知の値を安全な RankingMetric に丸める。Server Action / searchParams のように
 * クライアントが改変できる入力に対して、許可リスト外を既定（出場）へ落とす。
 * これで `aggFor` が undefined を返して集計が例外化することを防ぐ。
 */
export function coerceRankingMetric(value: unknown): RankingMetric {
  return typeof value === 'string' &&
    (RANKING_METRIC_KEYS as readonly string[]).includes(value)
    ? (value as RankingMetric)
    : DEFAULT_RANKING_METRIC
}

/**
 * ④大会統計・図詳細（`/tournaments/stats/[metric]`）でドリルできる指標。requirements §3.6 / §4.2。
 * - `score` 枚数差ヒスト ／ `competitors` 年別競技人口 ／ `participations` 年別大会参加人数。
 *   いずれも「全級＋各級（A〜E）」を並べて比較する（メインの完結図＝級別構成/新規参入者/
 *   一人当たり平均年参加数は詳細を持たない）。
 */
export type DetailMetric = 'score' | 'competitors' | 'participations'

export const DETAIL_METRIC_KEYS: readonly DetailMetric[] = [
  'score',
  'competitors',
  'participations',
]

/** 既定の詳細指標（不正な [metric] セグメントのフォールバック）。 */
export const DEFAULT_DETAIL_METRIC: DetailMetric = 'score'

/**
 * 未知の値を安全な DetailMetric に丸める。`/tournaments/stats/[metric]` の動的セグメントは
 * ユーザーが任意に打てるため、許可リスト外は既定（score）へ落として集計が例外化しないようにする。
 */
export function coerceDetailMetric(value: unknown): DetailMetric {
  return typeof value === 'string' &&
    (DETAIL_METRIC_KEYS as readonly string[]).includes(value)
    ? (value as DetailMetric)
    : DEFAULT_DETAIL_METRIC
}

/** 年として妥当（整数・現実的な範囲）な値のみ通す。他は undefined。 */
function validYear(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1900 && n <= 3000
    ? n
    : undefined
}

/**
 * StatsFilter を検証済みの安全な形に丸める：年は整数・現実範囲のみ、from>to は入替、
 * grades は A–E の正規順のみ（enum 外・非配列は捨てる）。信頼できない入力（Server Action・
 * searchParams 由来）を集計クエリに渡す前に必ず通す。これにより enum 外 grade や NaN 年で
 * DB エラー（500）が出るのを防ぐ。
 */
export function sanitizeStatsFilter(filter: StatsFilter | null | undefined): StatsFilter {
  const f = filter ?? {}
  let yearFrom = validYear(f.yearFrom)
  let yearTo = validYear(f.yearTo)
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    ;[yearFrom, yearTo] = [yearTo, yearFrom]
  }
  const grades = Array.isArray(f.grades)
    ? ALL_GRADES.filter((g) => f.grades!.includes(g))
    : []

  const out: StatsFilter = {}
  if (yearFrom != null) out.yearFrom = yearFrom
  if (yearTo != null) out.yearTo = yearTo
  if (grades.length > 0) out.grades = grades
  // boolean コアース：truthy（改変された '1' 等含む）のみ true、未指定/false は省略＝現級のみ。
  if (f.includeFormerGrade) out.includeFormerGrade = true
  return out
}
