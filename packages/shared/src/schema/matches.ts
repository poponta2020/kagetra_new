import { index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { tournamentClasses } from './tournament-classes'
import { tournamentParticipants } from './tournament-participants'
import { matchResultEnum, matchStatusEnum } from './enums'

/**
 * matches: 1 試合 = 選手視点 1 行。
 *
 * 通常の対戦は勝者○/敗者×の 2 行で重複出現（ロスレス）。不戦勝のみ 1 行（相手
 * なし・score_diff null・status='walkover'）。棄権は 2 行で score_diff null・
 * status='forfeit'。`result` は常に win/lose のいずれか（不戦勝も勝者視点 win）。
 *
 * 勝敗数は固定カラムに持たず、表示時に matches から `status='normal'` のみを
 * 数えて導出する（数え方を変えても再取込不要。不戦勝・棄権は勝敗数に含めない）。
 *
 * `opponent_participant_id` は同一級内で相手名を解決できた場合に張る（解決でき
 * なければ null のまま `opponent_name` の生テキストを保持）。相手参加者が消えた
 * ときは紐付けだけ外す（ON DELETE SET NULL）。`class_id` は participant 経由で
 * 辿れるが「級内の全試合」クエリ用に冗長保持（matches(class_id) index）。
 */
export const matches = pgTable(
  'matches',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    classId: integer('class_id')
      .notNull()
      .references(() => tournamentClasses.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    roundLabel: text('round_label'),
    participantId: integer('participant_id')
      .notNull()
      .references(() => tournamentParticipants.id, { onDelete: 'cascade' }),
    opponentParticipantId: integer('opponent_participant_id').references(
      () => tournamentParticipants.id,
      { onDelete: 'set null' },
    ),
    opponentName: text('opponent_name'),
    result: matchResultEnum('result').notNull(),
    scoreDiff: integer('score_diff'),
    status: matchStatusEnum('status').notNull().default('normal'),
  },
  (table) => [
    index('idx_matches_class_id').on(table.classId),
    index('idx_matches_participant_id').on(table.participantId),
  ],
)
