import { integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tournamentKindEnum } from './enums'

/**
 * tournament_series: 大会「系列」マスタ（「第N回○○大会」の ○○ にあたる単位）。
 *
 * 全日本かるた協会 HP を一次ソースに、各個人戦が第何回開催かをマスター化したもの。
 * すでに raw SQL（C:/tmp/prod_schema_series.sql）で本番投入済み（series 180）。本ファイルで
 * Drizzle 管理下に取り込む（tournament-entry-rosters PR-1a, baseline）。
 *
 * 列・制約名は **本番現物に一致**させる（CREATE は migration を冪等にして本番では no-op、
 * fresh DB では本番同名で作成）。`aliases` は名寄せ（resolveOrCreateEdition）用の別名配列。
 */
export const tournamentSeries = pgTable(
  'tournament_series',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // ② 大会一覧（年別）の通称表示用の略称（地名・通称の最短形。例: 大阪/多摩/名人戦東予選）。
    // 表示時に開催級（A→E）を連結（例: 大阪BC）。nullable＝未設定は正式名称フォールバック。
    // aliases（名寄せ用の別表記）とは用途が異なる。
    shortName: text('short_name'),
    kind: tournamentKindEnum('kind').notNull().default('individual'),
    note: text('note'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('tournament_series_name_key').on(table.name)],
)
