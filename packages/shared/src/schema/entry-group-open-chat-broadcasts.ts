import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { openChatBroadcastStatusEnum } from './enums'
import { entryGroups } from './entry-groups'
import { users } from './auth'

/**
 * entry_group_open_chat_broadcasts: オープンチャット配信の履歴（1 行 = 1 回の配信）。
 *
 * ★**`event_broadcast_messages` は使わない**（requirements §6 の契約）。同テーブルの
 * `UNIQUE(event_line_broadcast_id, mail_message_id)` は「1 メール = 1 配信」を DB
 * レベルで強制しており、オープンチャットの「再配信は毎回全件を送る」（§3.2.5）と
 * **原理的に両立しない** — 同じメールからの 2 回目の配信が制約違反で落ちる。
 * この UNIQUE を緩める解決は禁止（メール配信の冪等性は本機能と無関係に守られる）。
 *
 * したがってこの表は **UNIQUE を一切持たない追記専用ログ**。
 * - 「N 回配信済み」= `count(*)`
 * - 「前回配信以降に増えた行」= `entry_group_open_chats.created_at > max(sent_at)`
 *   （再配信ダイアログの「（今回追加）」印。AC-53）
 */
export const entryGroupOpenChatBroadcasts = pgTable('entry_group_open_chat_broadcasts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  entryGroupId: integer('entry_group_id')
    .notNull()
    .references(() => entryGroups.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  /** この配信で Flex に載せたオープンチャットの件数（毎回全件なので保存時点の総数）。 */
  sentCount: integer('sent_count').notNull().default(0),
  status: openChatBroadcastStatusEnum('status').notNull(),
  errorMessage: text('error_message'),
  sentByUserId: text('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
})
