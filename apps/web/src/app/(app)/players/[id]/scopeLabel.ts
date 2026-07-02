import { ALL_GRADES, type RankingMetric, type StatsFilter } from '@/lib/stats/types'

/**
 * 戦績ドリルダウン（ランキング → 選手詳細）の表示ロジックを純関数で切り出す。db を持たない
 * ので単体テストが容易。page.tsx はここで組んだ文言/href を並べるだけにする。
 */

/** searchParams の値は Next.js App Router では string / string[] / undefined。 */
type RawParam = string | string[] | undefined

/**
 * 指標 → 一覧の②追加絞り込み（優勝=1 / 入賞=8 / 他=絞らない）。requirements §3.3。
 * getPlayerRecord の `bracketAtMost` にそのまま渡す。
 */
export function metricBracketAtMost(metric: RankingMetric): 1 | 8 | undefined {
  if (metric === 'championships') return 1
  if (metric === 'nyusho') return 8
  return undefined
}

/** 期間の表示片。両端・単年・片側・全期間を文言化。 */
function periodLabel(filter: StatsFilter): string {
  const { yearFrom, yearTo } = filter
  if (yearFrom != null && yearTo != null) {
    return yearFrom === yearTo ? `${yearFrom}年` : `${yearFrom}〜${yearTo}年`
  }
  if (yearFrom != null) return `${yearFrom}年以降`
  if (yearTo != null) return `${yearTo}年以前`
  return '全期間'
}

/** 級の表示片。'A級大会' / 'B・C級大会'（A→E 正規順）／ 全級は '全級'。 */
function gradePart(filter: StatsFilter): string {
  const grades = filter.grades
  if (!grades || grades.length === 0) return '全級'
  return `${ALL_GRADES.filter((g) => grades.includes(g)).join('・')}級大会`
}

/**
 * 絞り込み条件の表示行。「2021〜2026年・A級大会での成績」形式（requirements §3.4）。
 * 全期間なら「全期間・…」、全級なら「…・全級での成績」。②（優勝/入賞）は一覧のみ更に
 * 絞られる旨を括弧書きで付す（ヘッダ集計は①母集合のまま）。
 */
export function formatRankingScopeLabel(metric: RankingMetric, filter: StatsFilter): string {
  const base = `${periodLabel(filter)}・${gradePart(filter)}での成績`
  if (metric === 'championships') return `${base}（優勝した大会のみ表示）`
  if (metric === 'nyusho') return `${base}（入賞した大会のみ表示）`
  return base
}

/**
 * 絞り込み解除リンク（全成績表示）の href。現 searchParams を全て複製し `all=1` を立てる。
 * `from=ranking`＋ランキング params を維持するので「← ランキングへ戻る」導線も残る
 * （requirements §3.5）。配列 param（?grades=A&grades=B）は各値を append して往復保持する。
 */
export function buildClearScopeHref(
  playerId: number,
  sp: Record<string, RawParam>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (key === 'all' || value == null) continue // all は最後に1つだけ立てる（重複防止）
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v)
    } else {
      params.append(key, value)
    }
  }
  params.set('all', '1')
  return `/players/${playerId}?${params.toString()}`
}
