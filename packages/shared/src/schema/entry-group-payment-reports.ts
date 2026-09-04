import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'
import { paymentReportAmountSourceEnum, paymentReportStatusEnum } from './enums'

/**
 * entry_group_payment_reports: 支払報告 **1 回 = 1 行**（payment-receipt-broadcast §3.2.5）。
 *
 * 「支払報告」ボタンを押した 1 回ぶんの記録。誰が・いつ・どの日を対象に・いくらの想定額で・
 * 何枚の証憑を・送れたのか を保持する。`entry_group_payment_notices`（1 グループ 1 行の
 * upsert）と違い、**追記専用の履歴**である — 未払に戻して再度報告した回も別の行として残る
 * （AC-19）。
 *
 * ★`message_text` に**送信した本文をそのまま保存する**。再送（AC-18）はこの文字列を
 * そのまま送り直すので、あとから参加費の集計値や規定単価が変わっても過去の報告の文面は
 * 揺れない。金額だけ保存して都度組み直す方式を採らないのはこのため（要件 §6 の未解決論点5）。
 *
 * ★ON DELETE は **CASCADE**。この行は送信の記録であり、グループが消えたら意味を失う
 * （`entry_group_payment_notices` / `entry_group_open_chats` と同じ規律）。
 */
export const entryGroupPaymentReports = pgTable(
  'entry_group_payment_reports',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    // この報告で `paid` へ倒そうとした日のスナップショット（events.id の配列）。
    // ★`int[]` ではなく **jsonb**（`entry_group_payment_notices.grade_counts` の前例に
    // 倣う）。raw SQL で `int[]` をバインドする経路の罠を持ち込まないため
    // （feedback_drizzle_sql_int_array_binding）。
    eventIds: jsonb('event_ids').$type<number[]>().notNull(),
    // 文面に載せた想定金額。算出できなかったとき（amount_source='none'）は NULL。
    amountJpy: integer('amount_jpy'),
    amountSource: paymentReportAmountSourceEnum('amount_source').notNull(),
    // その場集計（amount_source='tally'）のとき、級未設定で総額に算入できなかった延べ人数。
    // 振込連絡由来（'payment_notice'）のときは常に 0 —— 管理者が人数を確認して送った
    // 確定値なので注記しない（AC-11）。
    unknownGradeCount: integer('unknown_grade_count').notNull().default(0),
    // 送信した本文の正本。再送はこの文字列をそのまま送る（AC-18）。
    messageText: text('message_text').notNull(),
    // この報告に添えた証憑の枚数（`entry_group_payment_receipts` の行数と一致する）。
    receiptCount: integer('receipt_count').notNull().default(0),
    status: paymentReportStatusEnum('status').notNull(),
    errorMessage: text('error_message'),
    // 最後に送信できた日時。NULL = 一度も送れていない（failed / skipped_unlinked）。
    // 再送が成功したらここを進める。
    lastSentAt: timestamp('last_sent_at', { mode: 'date', withTimezone: true }),
    // 実行した管理者。会員削除時に記録ごと消さないよう SET NULL。
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 履歴はグループページで「新しい順」に引くだけ。FK インデックスが無いと
    // 件数が増えたときに全走査になる。
    index('entry_group_payment_reports_group_idx').on(t.entryGroupId),
  ],
)
