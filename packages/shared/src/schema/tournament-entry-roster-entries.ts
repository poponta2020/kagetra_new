import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { gradeEnum, rosterEntryStatusEnum } from './enums'
import { tournamentEntryRosters } from './tournament-entry-rosters'
import { players } from './players'
import { users } from './auth'

/**
 * tournament_entry_roster_entries: 名簿の各行 = 1 人（tournament-entry-rosters PR-3）。
 *
 * パースした各行を `players` に解決（姓名のみ同定＝homonym-risk-accepted、result-import と同型）、
 * 会員は `users` に紐付け（突合表示用）。`raw_*` は取込元の生スナップショット（常に正）。
 * `status` は出場状態（出場回数の素データ）。確定名簿の繰上りは再取込で confirmed を更新する。
 */
export const tournamentEntryRosterEntries = pgTable(
  'tournament_entry_roster_entries',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    rosterId: integer('roster_id')
      .notNull()
      .references(() => tournamentEntryRosters.id, { onDelete: 'cascade' }),
    // 同定した選手（姓名のみ）。未解決なら null（raw_name は常に保持）。
    playerId: integer('player_id').references(() => players.id, { onDelete: 'set null' }),
    // 紐付いた会員。会員でない/未同定なら null。突合表示（自会の誰が載っているか）に使う。
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    grade: gradeEnum('grade'),
    rawName: text('raw_name').notNull(),
    rawKana: text('raw_kana'),
    rawAffiliation: text('raw_affiliation'),
    rawDan: text('raw_dan'),
    status: rosterEntryStatusEnum('status').notNull(),
    seqNo: integer('seq_no'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('roster_entries_roster_id_idx').on(table.rosterId),
    index('roster_entries_player_id_idx').on(table.playerId),
    index('roster_entries_user_id_idx').on(table.userId),
  ],
)
