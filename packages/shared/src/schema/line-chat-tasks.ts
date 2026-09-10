import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { lineChatTaskKindEnum, lineChatTaskStatusEnum } from './enums'
import { membershipRenewals } from './membership-renewals'
import type { RenewalMentionTarget } from '../types'

/**
 * line_chat_tasks: 会 LINE グループへの OAM チャット予約送信タスク。
 *
 * match-tracker の `line-chat-worker`（Playwright 常駐・同一 VM）が
 * `/api/line-chat-worker/tasks` をポーリングして予約し、結果を報告してくる。
 * この行はその**公開契約の保存先**で、`status` の値はワーカーが送ってくる
 * 大文字の文字列そのもの（requirements §6・AC-22）。
 *
 * 冪等の要 ＝ 部分 UNIQUE `(renewal_id, kind, target_date, split_index)
 * WHERE status <> 'CANCELLED'`:
 *   - 19:30 バッチの同日再実行が 2 通目を作らない（AC-15）。
 *   - 取り消したタスク（締切変更・登録完了）は除外されるので、同じ日に
 *     改めて作り直せる。
 *   - 再試行は新しい行を作らず**同じ行を** FAILED → PENDING へ戻す。
 *
 * `message_text` は生成時に確定した完成形（未回答者を氏名テキストで列挙済み）。
 * ワーカーは `mentions[].placeholder`（本文中の氏名文字列）を OAM の `@` 候補
 * 選択へ置き換えるだけなので、`mentions` を解さない旧ワーカーや候補不一致でも
 * 本文がそのまま送られる＝契約レベルでフォールバックが成立する（AC-16）。
 *
 * ★載せてよい個人情報は**氏名だけ**。住所・電話・生年月日を混ぜない。
 */
export const lineChatTasks = pgTable(
  'line_chat_tasks',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    renewalId: integer('renewal_id')
      .notNull()
      .references(() => membershipRenewals.id, { onDelete: 'cascade' }),
    kind: lineChatTaskKindEnum('kind').notNull(),
    /**
     * 送信の対象日（JST）。案内は作成日、リマインドは対象日。冪等キーの一部で、
     * 「同じ日の同じ種別は 1 通」を表す。
     */
    targetDate: date('target_date', { mode: 'string' }).notNull(),
    /** 分割番号（0 起点）。メンション上限を超えた分を 10 分ずらして分ける。 */
    splitIndex: integer('split_index').notNull().default(0),
    /**
     * 予約送信時刻。OAM の予約は 10 分単位なので必ず 10 分境界・未来。
     * ★導出は呼び出し側（開始 Action・19:30 バッチ）の `schedule.ts` が持ち、
     * このテーブルの store は受け取った値を保存するだけ。
     */
    scheduledSendAt: timestamp('scheduled_send_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    /** 送信本文（完成形）。生成時に確定し、送信時に再計算しない（R13）。 */
    messageText: text('message_text').notNull(),
    /** メンション対象（表示名 + 本文中の氏名文字列）。解決できなければ空配列。 */
    mentions: jsonb('mentions').$type<RenewalMentionTarget[]>().notNull().default([]),
    /** このタスクが名指しした対象者の `users.id`（「載った回数」の集計元）。 */
    targetUserIds: jsonb('target_user_ids').$type<string[]>().notNull().default([]),
    status: lineChatTaskStatusEnum('status').notNull().default('PENDING'),
    /** ワーカーが報告した失敗コード（`PENDING_EXPIRED` 等はこちらで書く）。 */
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** ワーカーのメンション結果（`{ matched: [], unmatched: [] }`）。 */
    mentionResult: jsonb('mention_result'),
    /** RESERVING に入った時刻。30 分超で要確認へ倒す reconcile の判定に使う。 */
    reservingAt: timestamp('reserving_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('line_chat_tasks_slot_uq')
      .on(t.renewalId, t.kind, t.targetDate, t.splitIndex)
      .where(sql`${t.status} <> 'CANCELLED'`),
  ],
)
