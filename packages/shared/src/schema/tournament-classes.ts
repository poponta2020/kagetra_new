import { integer, pgTable, text } from 'drizzle-orm/pg-core'
import { gradeEnum } from './enums'
import { tournaments } from './tournaments'

/**
 * tournament_classes: 大会内の「級（クラス）」。
 *
 * `class_name` は自由文字列（標準ツールのシート名/級列をそのまま保持）。
 * `grade`(A–E) はそこから best-effort で導出した正規化値（非該当は null）。
 * `num_players` は集計シート等に出ていれば取り込む（任意）。`sheet_name` は
 * 取込元 Excel のシート名（後からの突合・デバッグ用）。
 */
export const tournamentClasses = pgTable('tournament_classes', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tournamentId: integer('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  className: text('class_name').notNull(),
  grade: gradeEnum('grade'),
  numPlayers: integer('num_players'),
  sheetName: text('sheet_name'),
})
