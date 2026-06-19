import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { mailMessages } from './mail-messages'
import { tournaments } from './tournaments'
import { users } from './auth'
import { resultDraftStatusEnum } from './enums'

/**
 * result_drafts: 結果 Excel の取込ドラフト = メール 1 通。
 *
 * mail-inbox で「結果として取り込む」を押すと `result_parse` ジョブが投入され、
 * mail-worker が Excel を**決定的にパース**（AI 不使用）して 1 行を格納する
 * （成功=`pending_review` / 署名不一致・失敗=`parse_failed`）。1 メール = 最大
 * 1 ドラフト（`message_id` UNIQUE）。tournament_drafts（AI 案内取込）の兄弟だが
 * AI 関連列（confidence/ai_*）は持たず `parser_version` のみ。
 *
 * `extracted_payload` はパーサが生成した級/参加者/試合の構造化 JSON。承認 (Task 4)
 * で tournaments/classes/participants/matches へ materialize し `tournament_id`
 * に作成した大会を記録する。
 *
 * 循環/自己 FK は migration の raw ALTER で付与（drizzle の循環型回避。
 * tournament_drafts.superseded_by_draft_id と同じ手法）:
 *   - `superseded_by_draft_id`: 訂正版で差し替えた旧ドラフトを指す自己 FK。
 *     ここでは plain integer。FK(ON DELETE SET NULL) は migration で付与。
 * `tournament_id` は通常の FK（tournaments を後から定義するため循環にならない）。
 */
export const resultDrafts = pgTable(
  'result_drafts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    messageId: integer('message_id')
      .notNull()
      .unique()
      .references(() => mailMessages.id, { onDelete: 'cascade' }),
    status: resultDraftStatusEnum('status').notNull().default('pending_review'),
    extractedPayload: jsonb('extracted_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    parserVersion: text('parser_version').notNull(),
    parseError: text('parse_error'),
    // 自己 FK。FK 制約は migration の raw ALTER で付与（plain integer のまま）。
    supersededByDraftId: integer('superseded_by_draft_id'),
    // 承認で作成した大会。tournaments を指す通常の FK（循環の正準側）。
    tournamentId: integer('tournament_id').references(() => tournaments.id, {
      onDelete: 'set null',
    }),
    approvedByUserId: text('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { mode: 'date', withTimezone: true }),
    rejectedByUserId: text('rejected_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    rejectedAt: timestamp('rejected_at', { mode: 'date', withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // inbox の結果ドラフト一覧は status 絞り込み + 新しい順。
    index('idx_result_drafts_status_created').on(table.status, table.createdAt.desc()),
  ],
)
