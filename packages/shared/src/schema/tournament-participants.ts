import { index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { tournamentClasses } from './tournament-classes'
import { players } from './players'

/**
 * tournament_participants: その大会・級ごとの「出場スナップショット」。
 *
 * 取込元 Excel の 1 行 = 1 参加者をほぼロスレスに保持する生データ層。`player_id`
 * は承認時に正規化キーで get-or-create した players への紐付け（未解決時は null、
 * 選手削除/再解決で null になり得るので ON DELETE SET NULL）。
 *
 * `dan` / `member_no` は **text**（"五段" / "5" / "A-123" など Excel の生表記を
 * そのまま保持。正規化はしない＝生データが常に正）。`final_rank` も順位列の生
 * テキスト（優勝/準優勝/３位…）をそのまま保持（数値化は導出不能なため）。
 */
export const tournamentParticipants = pgTable(
  'tournament_participants',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    classId: integer('class_id')
      .notNull()
      .references(() => tournamentClasses.id, { onDelete: 'cascade' }),
    playerId: integer('player_id').references(() => players.id, { onDelete: 'set null' }),
    seqNo: integer('seq_no'),
    name: text('name').notNull(),
    nameKana: text('name_kana'),
    affiliation: text('affiliation'),
    prefecture: text('prefecture'),
    // 生スナップショットのため text（"五段"/"5" 等の揺れをロスレス保持）。
    dan: text('dan'),
    memberNo: text('member_no'),
    finalRank: text('final_rank'),
  },
  (table) => [
    index('idx_participants_player_id').on(table.playerId),
    index('idx_participants_class_id').on(table.classId),
  ],
)
