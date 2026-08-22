import { integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'
import type { Grade } from '../types'

/**
 * entry_group_payment_notices: 名簿確定後の振込連絡（line-bot-message-revamp §3.3）。
 *
 * 1 グループ 1 行（`entry_group_id` UNIQUE の upsert）。**履歴は持たない** —
 * 振込連絡は再送できるが、送るのは常に「いま確定している人数・金額」であって
 * 過去の版を引き直す用途が無い（要綱再送・オープンチャット再送と同じ扱い）。
 *
 * ★**単価は保存しない。** 単価は協会規定額から `resolveEntryFee` が都度導出する値で、
 * 管理者が上書きしてよい種類の数字ではない（§3.3.2 / Non-goals）。規定額が改定されたら
 * 次回の送信から新しい額になるのが正しい。保存するのは**管理者が直した級別人数**だけ。
 *
 * ★ON DELETE は **CASCADE**。この行は送信の記録であり、グループが消えたら意味を失う
 * （`entry_group_open_chats` と同じ規律）。
 */
export const entryGroupPaymentNotices = pgTable(
  'entry_group_payment_notices',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    // 級 → 人数。初期値は参加費集計（`tallyEntryFeesForGroup` と同じ母集団）から
    // 引き、管理者が編集した結果をそのまま保存する（§3.3.2。再送で同じ数字を再現する）。
    // 人数 0 の級はキーごと落として構わない（文面側も 0 の行を出さない）。
    gradeCounts: jsonb('grade_counts').$type<Partial<Record<Grade, number>>>().notNull(),
    // 送信時点の総額（Σ 人数 × そのときの規定単価）。表示・監査用のスナップショットで、
    // 文面の再構築には使わない（文面は保存人数 × 都度導出した単価で組み直す）。
    totalJpy: integer('total_jpy').notNull(),
    // 最後に送信できた日時。NULL = まだ一度も送っていない（人数だけ保存した状態）。
    // push 失敗ではここを更新しない（§3.4「送信済みにしない」・AC-19）。
    lastSentAt: timestamp('last_sent_at', { mode: 'date', withTimezone: true }),
    // 最後に送信した管理者。会員削除時に記録ごと消さないよう SET NULL。
    lastSentBy: text('last_sent_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('entry_group_payment_notices_group_unique').on(t.entryGroupId)],
)
