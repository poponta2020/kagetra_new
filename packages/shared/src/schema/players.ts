import { index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth'

/**
 * players: 選手マスタ（全国の競技者。会員/非会員問わず）。
 *
 * tournament-results の名寄せ・グルーピング層。取込承認時 (Task 4) に各
 * `tournament_participants` を正規化キー `normalized_name`（姓名のみ）で
 * get-or-create してこの行に紐付ける。`participants` がその大会の「生スナップ
 * ショット」で常に正、`players` は後から再解決・マージできるグルーピング層と
 * いう役割分担（名寄せ誤りを生データを壊さず是正可能）。
 *
 * 同定キーは **姓名のみ**。所属会は「人 × 大会」の属性で生涯で変わる（高校→
 * 大学→社会人）ため識別キーに使わない（同姓同名も区別しない＝
 * homonym-risk-accepted）。`affiliation` は player 行では保持せず常に null とし、
 * 所属は participants（大会ごとの生値）を正とする。
 *
 * `normalized_name` は空白除去・NFKC・字体揺れ（○/〇・髙/高・﨑/崎 等）を吸収
 * した検索/突合キー。NOT NULL なので `UNIQUE(normalized_name)` で一意。
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
    // get-or-create の同定キー＝**正規化姓名のみ**（所属会は使わない＝
    // homonym-risk-accepted）。所属表記ゆれで同一人物が分裂するのを防ぐ。
    // normalized_name は NOT NULL なので NULLS の考慮は不要。この UNIQUE が張る
    // 一意インデックスが姓名の完全一致 lookup（戦績検索 Task 5）も兼ねるため
    // 別途の単独 index は持たない。過剰マージ（真の同姓同名の統合）のリスクは
    // players がマージ可能なグルーピング層であり生データ (participants) が常に正
    // なので後続の是正で吸収できる。
    unique('players_normalized_name_uq').on(table.normalizedName),
    index('idx_players_user_id').on(table.userId),
  ],
)
