export type TournamentKind = 'individual' | 'team'

export interface SeriesRow {
  id: number
  name: string
  aliases: string[]
  kind: TournamentKind
}

export interface SeriesCandidate {
  series: SeriesRow
  /** 100 = 正規化完全一致（name か alias）, 50 = 部分一致（包含）。 */
  score: number
}

export interface SeriesSearchCandidate extends SeriesCandidate {
  /** 検索語が alias に一致した場合、画面で根拠として表示する別名。 */
  matchedAlias: string | null
}

export const EXACT_MATCH_SCORE = 100
const CONTAINS_MATCH_SCORE = 50

/** 大会系列名向けの名寄せ正規化。ブラウザとサーバーの両方で使える純粋関数。 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[・･,，、.。\-―ー~〜‐-―（）()「」『』【】［］\[\]★☆◎○●◆■]/g, '')
    .toLowerCase()
}

export function scoreSeries(seriesNameGuess: string, series: SeriesRow): number {
  const guess = normalizeForMatch(seriesNameGuess)
  if (!guess) return 0
  const targets = [series.name, ...(series.aliases ?? [])]
    .map(normalizeForMatch)
    .filter(Boolean)
  let best = 0
  for (const target of targets) {
    if (target === guess) return EXACT_MATCH_SCORE
    if (target.includes(guess) || guess.includes(target)) {
      best = Math.max(best, CONTAINS_MATCH_SCORE)
    }
  }
  return best
}

function scoreSeriesForSearch(query: string, series: SeriesRow): number {
  const normalizedQuery = normalizeForMatch(query)
  if (!normalizedQuery) return 0

  const targets = [series.name, ...(series.aliases ?? [])]
    .map(normalizeForMatch)
    .filter(Boolean)
  let best = 0
  for (const target of targets) {
    if (target === normalizedQuery) return EXACT_MATCH_SCORE
    if (target.includes(normalizedQuery)) {
      best = Math.max(best, CONTAINS_MATCH_SCORE)
    }
  }
  return best
}

/** 自動解決用の候補順位。完全一致/包含以外は候補に含めない。 */
export function rankSeriesCandidates(
  seriesNameGuess: string,
  allSeries: SeriesRow[],
): SeriesCandidate[] {
  return allSeries
    .map((series) => ({ series, score: scoreSeries(seriesNameGuess, series) }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.series.name.localeCompare(b.series.name, 'ja'),
    )
}

function matchedAliasForQuery(query: string, series: SeriesRow): string | null {
  const normalizedQuery = normalizeForMatch(query)
  if (!normalizedQuery) return null
  const aliases = series.aliases ?? []

  const exactAlias = aliases.find(
    (alias) => normalizeForMatch(alias) === normalizedQuery,
  )
  if (exactAlias) return exactAlias

  if (normalizeForMatch(series.name) === normalizedQuery) return null

  return (
    aliases.find((alias) => {
      const normalizedAlias = normalizeForMatch(alias)
      return normalizedAlias.includes(normalizedQuery)
    }) ?? null
  )
}

/**
 * 管理者の検索UI用。空検索では同種別の全系列、入力時は正準名/別名の部分一致を返す。
 * autoResolveEdition の保守的な自動解決とは別契約で、選択確定は呼び出し側がIDで行う。
 */
export function searchSeriesCandidates(
  query: string,
  allSeries: SeriesRow[],
  kind: TournamentKind,
): SeriesSearchCandidate[] {
  const compatible = allSeries.filter((series) => series.kind === kind)
  if (!normalizeForMatch(query)) {
    return compatible
      .map((series) => ({ series, score: 0, matchedAlias: null }))
      .sort((a, b) => a.series.name.localeCompare(b.series.name, 'ja'))
  }

  return compatible
    .map((series) => ({
      series,
      score: scoreSeriesForSearch(query, series),
      matchedAlias: matchedAliasForQuery(query, series),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.series.name.localeCompare(b.series.name, 'ja'),
    )
}
