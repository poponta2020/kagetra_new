import { sql, type SQL } from 'drizzle-orm'
import type { StatsFilter } from './types'

/**
 * ④大会統計（getStatsOverview / getStatsDetail）の期間（年 from–to）WHERE 断片。
 *
 * 大会統計は**級では絞らない**（級は比較軸＝図内 or 詳細で並置。requirements §3.2）ので、
 * ランキングの `filterConds`（period＋grades）とは別に、期間だけを絞るこの純 SQL ヘルパを
 * 使う。生 SQL（`db.execute`）側で tournaments を **エイリアス `t`** で join している前提で、
 * `t.event_date` を年境界の date と比較する。既存 WHERE 句に続けて **AND で連結**できるよう
 * 先頭に `AND` を付けて返す（フィルタ無しなら空 SQL）。
 *
 * year 指定時は `event_date` の日付比較になるため、event_date 無し大会は自然に除外される
 * （NULL 比較が偽）。呼び出し側は必ず `sanitizeStatsFilter` を通した値を渡すこと
 * （不正年で DB エラー＝500 にならないように）。
 */
export function periodConds(filter: StatsFilter): SQL {
  const parts: SQL[] = []
  if (filter.yearFrom != null) {
    parts.push(sql`t.event_date >= ${`${filter.yearFrom}-01-01`}::date`)
  }
  if (filter.yearTo != null) {
    parts.push(sql`t.event_date <= ${`${filter.yearTo}-12-31`}::date`)
  }
  return parts.length > 0 ? sql`AND ${sql.join(parts, sql` AND `)}` : sql``
}
