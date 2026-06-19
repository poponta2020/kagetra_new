import { foreignKey, index, integer, pgTable, text } from 'drizzle-orm/pg-core'
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
 *
 * 整合性 (Codex R1 should_fix): `(participant_id, class_id)` は
 * tournament_participants(id, class_id) への composite FK で「試合の級＝参加者の
 * 所属級」を DB レベルで保証する（下記 table 配列）。これにより冗長な class_id を
 * 級別集計/一覧で安全に信頼できる（別級の参加者を指す不整合な試合行を弾く）。
 * opponent 側は同じ保証を composite FK にできない（ON DELETE SET NULL が NOT NULL
 * の class_id を co-null できず削除が失敗する）。opponent の同一級は materialize 時
 * に同一級の participant のみ解決することで担保する（opponent_name を正とする soft 参照）。
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
    // FK は (participant_id, class_id) の composite FK で張る（下記 table 配列）。
    // 単独 FK にすると class_id と参加者の所属級の整合が DB で保証されない。
    participantId: integer('participant_id').notNull(),
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
    // (participant_id, class_id) → tournament_participants(id, class_id)。
    // 「試合の級＝参加者の所属級」を保証。ON DELETE CASCADE は単独 FK 時と同じく
    // 参加者削除で試合行を消す。
    foreignKey({
      columns: [table.participantId, table.classId],
      foreignColumns: [tournamentParticipants.id, tournamentParticipants.classId],
      name: 'matches_participant_id_class_id_fk',
    }).onDelete('cascade'),
  ],
)
