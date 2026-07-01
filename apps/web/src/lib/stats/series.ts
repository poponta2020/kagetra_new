import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * ② 大会結果の「大会別ビュー」（シリーズ一覧 `/tournaments/series`）とシリーズ詳細
 * （`/tournaments/series/[id]`）のサーバー集計。requirements §3.4 / §4.2、design-spec §3.4 / §3.6。
 *
 * 系列（tournament_series）と開催（tournament_series_editions）の**台帳**を主ソースにする。
 * 各回次に結果データ（tournaments・edition_id で紐付く）があれば優勝者・参加者数を重ねる。
 * 収録は 2010〜のみ・以前や未取込の回は「記録なし」、中止回は状態で明示（design-spec §5）。
 */

export interface SeriesListRow {
  seriesId: number
  name: string
  kind: 'individual' | 'team'
  /** 台帳の総回次数（editions 行数）。 */
  editionCount: number
  editionNumberFrom: number | null
  editionNumberTo: number | null
  /** 直近開催年（editions の max year・null 年は無視）。並び替えキー。 */
  recentYear: number | null
  heldCount: number
  cancelledCount: number
  unconfirmedCount: number
}

export interface SeriesEditionRow {
  editionId: number
  editionNumber: number
  year: number | null
  status: 'held' | 'cancelled' | 'unconfirmed'
  /** 結果データへの代表大会 id（大会詳細への遷移先）。紐付く大会が無ければ null（記録なし）。 */
  tournamentId: number | null
  /** 優勝者（最上位級の derived_bracket=1）。導出不能/未収録は null。 */
  championName: string | null
  /** 全級合計の参加者数。紐付く大会が無ければ null（記録なし）。 */
  participantCount: number | null
}

/** 参加者数推移の 1 点（design-spec §3.6.3：記録ある年＋中止年のみ）。 */
export interface ParticipantTrendPoint {
  year: number
  count: number
  /** 中止回（朱破線で欠落明示）。 */
  cancelled: boolean
}

export interface SeriesDetail {
  seriesId: number
  name: string
  kind: 'individual' | 'team'
  editionNumberFrom: number | null
  editionNumberTo: number | null
  yearFrom: number | null
  yearTo: number | null
  heldCount: number
  cancelledCount: number
  unconfirmedCount: number
  /** 回次一覧（新しい順＝edition_number 降順）。 */
  editions: SeriesEditionRow[]
  /** 参加者数推移（edition_number 昇順・記録ある年＋中止年のみ）。 */
  participantTrend: ParticipantTrendPoint[]
}

/** pg の QueryResult 行は Record<string, unknown>。数値/文字列を安全に取り出す。 */
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}
function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v)
}

/**
 * getSeriesList — 大会別ビュー（180 系列）。各系列＝累計回次・回次範囲・直近開催年・状態内訳。
 * 直近開催年降順（null は末尾）→ 名前。`query` があれば系列名で ILIKE 絞り込み。
 */
export async function getSeriesList(query?: string): Promise<SeriesListRow[]> {
  const q = query?.trim()
  // ILIKE のワイルドカードはエスケープ（ユーザー入力由来の % _ を literal 扱い）。
  // ESCAPE '\' を明示し、置換済みの \% \_ を必ず literal 扱いにする（server 設定非依存）。
  const nameCond: SQL = q
    ? sql`WHERE s.name ILIKE ${'%' + q.replace(/([%_\\])/g, '\\$1') + '%'} ESCAPE '\\'`
    : sql``
  const res = await db.execute(sql`
    SELECT s.id, s.name, s.kind,
      count(e.id)::int AS edition_count,
      min(e.edition_number)::int AS ed_from,
      max(e.edition_number)::int AS ed_to,
      max(e.year)::int AS recent_year,
      -- 状態別は count(e.id) FILTER で数える（editions 0 件の系列は LEFT JOIN の NULL 拡張行を
      -- 生むが e.id が NULL なので確実に除外＝空系列を 1 件の held と誤集計しない）。
      count(e.id) FILTER (WHERE e.status = 'held')::int AS held,
      count(e.id) FILTER (WHERE e.status = 'cancelled')::int AS cancelled,
      count(e.id) FILTER (WHERE e.status = 'unconfirmed')::int AS unconfirmed
    FROM tournament_series s
    LEFT JOIN tournament_series_editions e ON e.series_id = s.id
    ${nameCond}
    GROUP BY s.id
    ORDER BY recent_year DESC NULLS LAST, s.name
  `)
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    seriesId: num(r.id),
    name: String(r.name),
    kind: r.kind === 'team' ? 'team' : 'individual',
    editionCount: num(r.edition_count),
    editionNumberFrom: numOrNull(r.ed_from),
    editionNumberTo: numOrNull(r.ed_to),
    recentYear: numOrNull(r.recent_year),
    heldCount: num(r.held),
    cancelledCount: num(r.cancelled),
    unconfirmedCount: num(r.unconfirmed),
  }))
}

/**
 * getSeriesDetail — 1 系列の回次一覧＋参加者数推移。存在しなければ null。
 *
 * 台帳（editions）を主ソースに、結果データ（tournaments）から参加者数・優勝者・遷移先を重ねる。
 * 優勝者は最上位級（A→E）の derived_bracket=1 を採用。参加者数は edition に紐付く全大会・全級の
 * distinct 参加者数。遷移先 tournament は優勝者の属する大会（無ければ最小 id）。
 */
export async function getSeriesDetail(seriesId: number): Promise<SeriesDetail | null> {
  if (!Number.isInteger(seriesId) || seriesId <= 0) return null

  const seriesRes = await db.execute(sql`
    SELECT id, name, kind FROM tournament_series WHERE id = ${seriesId} LIMIT 1
  `)
  const s = seriesRes.rows[0] as Record<string, unknown> | undefined
  if (!s) return null

  // 回次台帳＋結果データの集約（参加者数・代表大会）を 1 パスで。
  const edRes = await db.execute(sql`
    SELECT e.id AS edition_id, e.edition_number, e.year, e.status,
      count(DISTINCT tp.id)::int AS participant_count,
      count(DISTINCT t.id)::int AS tournament_count,
      min(t.id)::int AS any_tournament_id
    FROM tournament_series_editions e
    LEFT JOIN tournaments t ON t.edition_id = e.id
    LEFT JOIN tournament_classes tc ON tc.tournament_id = t.id
    LEFT JOIN tournament_participants tp ON tp.class_id = tc.id
    WHERE e.series_id = ${seriesId}
    GROUP BY e.id
    ORDER BY e.edition_number DESC
  `)

  // 優勝者（最上位級 A→E の優勝）と、その優勝者の大会 id を回次ごとに 1 件。
  // 順位定義は大会詳細（buildWinners）と単一ソースに揃える：導出可能級は derived_bracket=1、
  // 導出不能級（リーグ等・bracket null）は final_rank の「優勝」（準優勝は除外）にフォールバック。
  // 同一級では bracket=1 を final_rank 優勝より優先し、級順（A→E）で最上位級の優勝者を採る
  // （非導出の最上位級を下位級の bracket=1 で上書きしない）。
  const champRes = await db.execute(sql`
    SELECT DISTINCT ON (e.id) e.id AS edition_id, tp.name AS champion_name, t.id AS tournament_id
    FROM tournament_series_editions e
    JOIN tournaments t ON t.edition_id = e.id
    JOIN tournament_classes tc ON tc.tournament_id = t.id
    JOIN tournament_participants tp ON tp.class_id = tc.id
    WHERE e.series_id = ${seriesId}
      AND (
        tp.derived_bracket = 1
        OR (tp.derived_bracket IS NULL AND tp.final_rank LIKE '%優勝%' AND tp.final_rank NOT LIKE '%準優%')
      )
    ORDER BY e.id,
      CASE tc.grade WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 WHEN 'E' THEN 5 ELSE 6 END,
      CASE WHEN tp.derived_bracket = 1 THEN 0 ELSE 1 END,
      tc.id, tp.id
  `)
  const champByEdition = new Map<number, { name: string; tournamentId: number }>()
  for (const r of champRes.rows as Record<string, unknown>[]) {
    champByEdition.set(num(r.edition_id), {
      name: String(r.champion_name),
      tournamentId: num(r.tournament_id),
    })
  }

  const editions: SeriesEditionRow[] = (edRes.rows as Record<string, unknown>[]).map((r) => {
    const editionId = num(r.edition_id)
    const hasResults = num(r.tournament_count) > 0
    const champ = champByEdition.get(editionId)
    return {
      editionId,
      editionNumber: num(r.edition_number),
      year: numOrNull(r.year),
      status: (String(r.status) as SeriesEditionRow['status']) ?? 'held',
      // 遷移先＝優勝者の大会（あれば）→ 無ければ任意の紐付け大会 → 記録なしは null。
      tournamentId: champ?.tournamentId ?? (hasResults ? numOrNull(r.any_tournament_id) : null),
      championName: champ?.name ?? null,
      participantCount: hasResults ? num(r.participant_count) : null,
    }
  })

  // サマリー（状態内訳・回次範囲・年範囲）。
  const heldCount = editions.filter((e) => e.status === 'held').length
  const cancelledCount = editions.filter((e) => e.status === 'cancelled').length
  const unconfirmedCount = editions.filter((e) => e.status === 'unconfirmed').length
  const nums = editions.map((e) => e.editionNumber)
  const years = editions.map((e) => e.year).filter((y): y is number => y != null)

  // 参加者数推移：記録ある年（参加者数>0）＋中止年（欠落明示）のみ・edition_number 昇順。
  const trend: ParticipantTrendPoint[] = [...editions]
    .reverse() // editions は降順なので昇順へ
    .filter((e) => e.year != null && ((e.participantCount ?? 0) > 0 || e.status === 'cancelled'))
    .map((e) => ({
      year: e.year!,
      count: e.status === 'cancelled' ? 0 : (e.participantCount ?? 0),
      cancelled: e.status === 'cancelled',
    }))

  return {
    seriesId: num(s.id),
    name: String(s.name),
    kind: s.kind === 'team' ? 'team' : 'individual',
    editionNumberFrom: nums.length ? Math.min(...nums) : null,
    editionNumberTo: nums.length ? Math.max(...nums) : null,
    yearFrom: years.length ? Math.min(...years) : null,
    yearTo: years.length ? Math.max(...years) : null,
    heldCount,
    cancelledCount,
    unconfirmedCount,
    editions,
    participantTrend: trend,
  }
}
