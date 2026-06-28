import { date, foreignKey, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { tournamentSeriesEditions } from './tournament-series-editions'

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
  // tournament-entry-rosters PR-1a: 開催（edition）へのハブ。本番には raw ALTER で
  // 列＋FK（tournaments_edition_id_fkey, ON DELETE SET NULL）が既存。flow②（結果取込）で
  // 設定する（PR-5）。編集は edition 解決コア経由。
  editionId: integer('edition_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // 制約名は本番現物（tournaments_edition_id_fkey）に一致させる。baseline migration は
  // 冪等で本番では no-op、fresh DB（push/migrate）では同名で作成される。
  foreignKey({
    columns: [table.editionId],
    foreignColumns: [tournamentSeriesEditions.id],
    name: 'tournaments_edition_id_fkey',
  }).onDelete('set null'),
  // tournament-entry-rosters (Codex R3 should_fix): edition ハブ参照列の btree index。
  index('tournaments_edition_id_idx').on(table.editionId),
])
