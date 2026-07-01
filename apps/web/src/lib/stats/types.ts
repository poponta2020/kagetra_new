/**
 * 統計セクション（③選手ランキング・④大会統計）横断の共通フィルタ型。
 * requirements §3.2 / §4.2。
 */

/** 級（A–E）。tournament_classes.grade（正規化値）に対応。 */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

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
}
