import {
  ALL_GRADES,
  DEFAULT_RANKING_METRIC,
  DEFAULT_WIN_RATE_MIN_MATCHES,
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

/** 素の URL（明示フラグ無し）で開いたときのデフォルト期間の遡り年数（当年−N〜当年）。① */
const DEFAULT_YEARS_BACK = 5

/** 素の URL のデフォルト級（③・ランキングタブのみ）。 */
const DEFAULT_GRADES: readonly Grade[] = ['A']

/**
 * 「明示的に絞り込み中」フラグの param 名（①③）。**無し**＝素のデフォルトビュー
 * （page 側で級A・直近5年を注入）／**有り**＝URL の値そのまま（grades 無し＝全級・years
 * 無し＝全期間）。デフォルトを URL 省略で表す方式と「全級/全期間を明示選択で残す」を両立する。
 */
const EXPLICIT_PARAM = 'f'

/**
 * filter を反映した /players/ranking の href。
 *
 * - **非明示**（`explicit=false`・素のデフォルトビュー）: 指標のみを載せてフィルタは省略する
 *   （素の URL のまま＝ page 側でデフォルト「現在A級・直近5年」が注入される）。指標チップの
 *   切替でもモード（非明示）を保つ。
 * - **明示**（`explicit=true`）: 明示フラグ `f=1` を立て、grades/years をそのまま載せる
 *   （grades 無し＝全級・years 無し＝全期間を URL で表現）。「適用」やフィルタ付き遷移で使う。
 */
export function buildRankingHref(
  metric: RankingMetric,
  filter: StatsFilter,
  explicit = false,
): string {
  const params = new URLSearchParams()
  if (metric !== DEFAULT_RANKING_METRIC) params.set('metric', metric)
  if (explicit) {
    params.set(EXPLICIT_PARAM, '1')
    if (filter.yearFrom != null) params.set('yearFrom', String(filter.yearFrom))
    if (filter.yearTo != null) params.set('yearTo', String(filter.yearTo))
    if (filter.grades && filter.grades.length > 0) {
      // 級は正規順（A→E）で安定化。
      params.set('grades', ALL_GRADES.filter((g) => filter.grades!.includes(g)).join(','))
    }
    // ⑤ 昇段済みを含む（true のときだけ載せる・false は省略）。
    if (filter.includeFormerGrade === true) params.set('includeFormer', '1')
  }
  // ④ 最低試合数は明示フラグ（f）と**独立**のパラメータ。既定（20）以外のときだけ載せ、
  // 非明示（デフォルトビュー）でも保持する（デフォルト注入①③の対象外）。勝率以外の指標でも
  // URL には残す（集計側で無視されるだけ）ので、指標を切り替えても値が保たれる。
  if (filter.minMatches != null && filter.minMatches !== DEFAULT_WIN_RATE_MIN_MATCHES) {
    params.set('minMatches', String(filter.minMatches))
  }
  const qs = params.toString()
  return qs ? `/players/ranking?${qs}` : '/players/ranking'
}

/**
 * ランキング一覧の行 → 選手詳細の href（④）。`from=ranking`＋現在のランキング絞り込み params を
 * 複写する。用途は (a)詳細側の「← ランキングへ戻る」ラベル判定、(b) `router.back()` が使えない
 * 直リンク流入時のフォールバック遷移先の再構成、(c) 中クリック/JS 無効時の遷移先。ランキング
 * params は `buildRankingHref` と同形（非明示＝指標のみ・明示＝f=1＋フィルタ）で往復可能。
 */
export function buildPlayerHrefFromRanking(
  playerId: number,
  metric: RankingMetric,
  filter: StatsFilter,
  explicit: boolean,
): string {
  const rankingHref = buildRankingHref(metric, filter, explicit)
  const qIndex = rankingHref.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? rankingHref.slice(qIndex + 1) : '')
  params.set('from', 'ranking')
  return `/players/${playerId}?${params.toString()}`
}

/** searchParams の値は Next.js App Router では string だけでなく配列にもなり得る。 */
type RawParam = string | string[] | undefined

/** 配列 searchParam（?k=a&k=b）は先頭を採用。単値/未指定はそのまま。 */
function firstParam(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export interface ParsedRankingParams {
  metric: RankingMetric
  filter: StatsFilter
  /**
   * 明示的に絞り込み中か（false＝素のデフォルトビュー）。UI（フィルタバー/指標チップ/行リンク）
   * と href 生成でモードを保つために page → 各コンポーネントへ伝播する。
   */
  explicit: boolean
}

/**
 * /players/ranking の searchParams を検証済みの `{ metric, filter, explicit }` に。
 *
 * - **明示フラグ無し**（素の URL・「クリア」後）→ 強い実用デフォルト **級A・直近5年
 *   （当年−5〜当年）** を注入し `explicit=false`。①③。指標は URL から採る（指標切替でモード維持）。
 * - **明示フラグ有り**（`f=1`）→ URL の grades/years をそのまま採用（grades 無し＝全級・years
 *   無し＝全期間）し `explicit=true`。①③⑤の「全級/全期間を明示で残す」を満たす。
 *
 * 指標は許可リストへ丸め、年/級は `sanitizeStatsFilter` で妥当な値のみ採用（不正は捨てる・
 * yearFrom>yearTo は入替）。当年は純関数維持のため引数で受ける（サーバー時刻は page 側で算出）。
 *
 * `searchParams` はユーザーが直接改変できる入力で、Next.js は同名 query 複数指定
 * （`?grades=A&grades=B`）を **配列**で渡す。metric/year/フラグは先頭を採用、grades は配列・
 * カンマ区切りの両方を平坦化してから検証する（`.split` を配列に対して呼んでページが 500 化
 * するのを防ぐ）。
 */
export function parseRankingParams(
  sp: {
    metric?: RawParam
    yearFrom?: RawParam
    yearTo?: RawParam
    grades?: RawParam
    f?: RawParam
    includeFormer?: RawParam
    minMatches?: RawParam
  },
  currentYear: number,
): ParsedRankingParams {
  const metric = coerceRankingMetric(firstParam(sp.metric))
  const explicit = firstParam(sp.f) === '1'

  // ④ 最低試合数は明示フラグと独立に読む（不正/未指定は sanitize が捨てて既定 20 扱い）。
  const minMatchesRaw = firstParam(sp.minMatches)
  const minMatches = minMatchesRaw != null ? Number(minMatchesRaw) : undefined

  if (!explicit) {
    // 素の URL／クリア後 → デフォルト（現在A級・直近5年）。①③。minMatches は独立に保持。
    return {
      metric,
      explicit: false,
      filter: sanitizeStatsFilter({
        grades: [...DEFAULT_GRADES],
        yearFrom: currentYear - DEFAULT_YEARS_BACK,
        yearTo: currentYear,
        minMatches,
      }),
    }
  }

  // 明示モード → URL の値そのまま（grades 無し＝全級・years 無し＝全期間）。
  const candidate: StatsFilter = {}
  const yearFrom = firstParam(sp.yearFrom)
  const yearTo = firstParam(sp.yearTo)
  if (yearFrom != null) candidate.yearFrom = Number(yearFrom)
  if (yearTo != null) candidate.yearTo = Number(yearTo)

  const rawGrades = Array.isArray(sp.grades)
    ? sp.grades.flatMap((v) => v.split(','))
    : (sp.grades?.split(',') ?? [])
  if (rawGrades.length > 0) candidate.grades = rawGrades as Grade[]

  const includeFormer = firstParam(sp.includeFormer)
  if (includeFormer === '1' || includeFormer === 'true') candidate.includeFormerGrade = true

  if (minMatches != null) candidate.minMatches = minMatches

  return { metric, explicit: true, filter: sanitizeStatsFilter(candidate) }
}
