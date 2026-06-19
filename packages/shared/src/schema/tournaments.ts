import { date, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * tournaments: 1 大会 = 1 取込ファイル（result_drafts 1 通の承認で 1 行）。
 *
 * 同一大会が複数ファイルで届いても各 1 行（マージは後続フェーズ）。
 *
 * `event_date` / `venue` は大会報告シート由来の任意項目で v1 では基本 null
 * （大会報告のパースは v1 対象外。レビュー画面で手入力可）。`event_date` は
 * 時刻を持たないカレンダー日付なので TZ ずれを避けて string モードの `date` 型。
 *
 * `source_result_draft_id` は「この大会を生成したドラフト」への逆参照
 * （プロビナンス）。result_drafts.tournament_id とで相互参照（循環 FK）になる
 * ため、こちら側は **プレーンな integer 列**として宣言し、FK 制約は migration
 * 内の raw ALTER（ON DELETE SET NULL）で付与する。drizzle のスキーマ定義で双方
 * を `.references()` にすると TypeScript の循環型参照になるための回避
 * （tournament_drafts.superseded_by_draft_id と同じ手法）。正準な紐付けは
 * result_drafts.tournament_id 側を辿ること。
 */
export const tournaments = pgTable('tournaments', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  eventDate: date('event_date'),
  venue: text('venue'),
  // 循環 FK のため plain integer。FK は migration の raw ALTER で付与。
  sourceResultDraftId: integer('source_result_draft_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
