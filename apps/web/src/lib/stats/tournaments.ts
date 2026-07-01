import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ALL_GRADES, type Grade } from './types'

/**
 * ② 大会結果の「年別ビュー」（大会一覧 `/tournaments`）のサーバー集計。requirements §3.4 / §4.2、
 * design-spec §3.4。全 1,496 大会を開催日降順で返す（フロントで年セクション化＋もっと見る）。
 * 各行＝大会名／開催日・会場／級構成（A〜E のトーンドット）＋参加者数。大会名検索（`query`）・
 * 単一年（`year`）で絞り込める。中止は紐付く開催（edition）の状態で判定（結果は held のみなので稀）。
 */

export interface TournamentListRow {
  tournamentId: number
  name: string
  eventDate: string | null
  venue: string | null
  /** 開催年（event_date の年・null なら日付不明）。フロントの年セクション見出し。 */
  year: number | null
  /** 出場級（A〜E・正規順）。トーンドット表示用。 */
  grades: Grade[]
  /** 全級合計の参加者数。 */
  participantCount: number
  /** 紐付く開催が中止（rare/defensive・結果は基本 held）。 */
  cancelled: boolean
}

export interface TournamentListResult {
  rows: TournamentListRow[]
  /** フィルタ該当の総大会数（もっと見るの母数・offset 非依存）。 */
  total: number
}

const DEFAULT_LIMIT = 200

/** grades 列を JS 文字列配列へ。JS 配列（text[] キャスト後）も生の `{C,D}` 文字列も受ける。 */
function parseGradeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') {
    const inner = v.replace(/^\{|\}$/g, '').trim()
    return inner ? inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim()) : []
  }
  return []
}

/** 絞り込み WHERE（大会名 ILIKE・単一年の日付範囲）。tournaments を alias `t` で使う前提。 */
function listConds(query: string | undefined, year: number | undefined): SQL[] {
  const conds: SQL[] = []
  const q = query?.trim()
  if (q) {
    conds.push(sql`t.name ILIKE ${'%' + q.replace(/([%_\\])/g, '\\$1') + '%'}`)
  }
  if (year != null && Number.isInteger(year)) {
    conds.push(sql`t.event_date >= ${`${year}-01-01`}::date`)
    conds.push(sql`t.event_date <= ${`${year}-12-31`}::date`)
  }
  return conds
}

/**
 * getTournamentList — 年別ビュー。開催日降順（null 日付は末尾）→ id 降順で `limit`/`offset`
 * ページング（もっと見る）。信頼できない入力（searchParams）でも 500 にならないよう limit/offset を
 * クランプし、year は整数のみ採用する。
 */
export async function getTournamentList(
  query?: string,
  year?: number,
  limit = DEFAULT_LIMIT,
  offset = 0,
): Promise<TournamentListResult> {
  const safeYear = year != null && Number.isInteger(year) ? year : undefined
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, DEFAULT_LIMIT) : DEFAULT_LIMIT
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0
  const conds = listConds(query, safeYear)
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``

  const res = await db.execute(sql`
    SELECT t.id, t.name, t.event_date, t.venue,
      extract(year FROM t.event_date)::int AS year,
      e.status AS edition_status,
      count(DISTINCT tp.id)::int AS participant_count,
      -- enum 配列は node-pg に型パーサが無く生の配列文字列で返るため text[] へキャスト
      -- する（text[] は組み込みパーサで JS 配列になる）。
      array_remove(array_agg(DISTINCT tc.grade), NULL)::text[] AS grades
    FROM tournaments t
    LEFT JOIN tournament_series_editions e ON e.id = t.edition_id
    LEFT JOIN tournament_classes tc ON tc.tournament_id = t.id
    LEFT JOIN tournament_participants tp ON tp.class_id = tc.id
    ${where}
    GROUP BY t.id, e.status
    ORDER BY t.event_date DESC NULLS LAST, t.id DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `)

  const [countRes] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM tournaments t ${where}`)
  ).rows as Record<string, unknown>[]

  const rows: TournamentListRow[] = (res.rows as Record<string, unknown>[]).map((r) => {
    // grades は text[] キャストで JS 配列になる。念のため生文字列 `{C,D}` も受ける。
    const rawGrades = parseGradeArray(r.grades)
    const grades = ALL_GRADES.filter((g) => rawGrades.includes(g))
    const year = r.year == null ? null : Number(r.year)
    return {
      tournamentId: Number(r.id),
      name: String(r.name),
      eventDate: r.event_date == null ? null : String(r.event_date),
      venue: r.venue == null ? null : String(r.venue),
      year: Number.isFinite(year) ? year : null,
      grades,
      participantCount: Number(r.participant_count ?? 0),
      cancelled: r.edition_status === 'cancelled',
    }
  })

  return { rows, total: Number(countRes?.n ?? 0) }
}
