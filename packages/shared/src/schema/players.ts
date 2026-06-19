import { index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth'

/**
 * players: 選手マスタ（全国の競技者。会員/非会員問わず）。
 *
 * tournament-results の名寄せ・グルーピング層。取込承認時 (Task 4) に各
 * `tournament_participants` を正規化キー `(normalized_name, affiliation)` で
 * get-or-create してこの行に紐付ける。`participants` がその大会の「生スナップ
 * ショット」で常に正、`players` は後から再解決・マージできるグルーピング層と
 * いう役割分担（名寄せ誤りを生データを壊さず是正可能）。
 *
 * `normalized_name` は空白除去・NFKC・字体揺れ（○/〇・髙/高 等）を吸収した
 * 検索/突合キー。`UNIQUE(normalized_name, affiliation)` は **NULLS NOT
 * DISTINCT** で宣言する（下記コメント参照）。
 *
 * `user_id` は会員同定（players ↔ users 紐付け）用だが v1 では基本 null。
 * 同定は後続/管理者操作。ユーザー削除でも選手成績は残すので ON DELETE SET NULL。
 */
export const players = pgTable(
  'players',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    displayName: text('display_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    nameKana: text('name_kana'),
    affiliation: text('affiliation'),
    prefecture: text('prefecture'),
    // 会員同定は後続。v1 は名寄せ (players 自動 get-or-create) までで user_id は null。
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // get-or-create の同定キー。affiliation は null になる選手が多数のため
    // **NULLS NOT DISTINCT**（PostgreSQL 15+）で宣言する。既定の NULLS DISTINCT
    // だと (同名, affiliation=NULL) の行同士が衝突せず get-or-create が毎回新規
    // 行を作って重複する。所属不明の選手は「名前のみが同定キー」になるのが意図。
    // 過剰マージのリスクは players がマージ可能なグルーピング層であり生データ
    // (participants) が常に正なので後続の是正で吸収できる。
    unique('players_normalized_name_affiliation_uq')
      .on(table.normalizedName, table.affiliation)
      .nullsNotDistinct(),
    // 選手検索（戦績ページ Task 5）の主キー。
    index('idx_players_normalized_name').on(table.normalizedName),
    index('idx_players_user_id').on(table.userId),
  ],
)
