import { index, integer, pgTable, timestamp, unique } from 'drizzle-orm/pg-core'
import { eventLineBroadcasts } from './event-line-broadcasts'
import { mailAttachments } from './mail-attachments'

/**
 * event_broadcast_guideline_attachments: 招待コード発行モーダルで管理者が
 * 「要綱として送信するファイル」に選んだ mail_attachments を、対象イベントの
 * LINE 連携 (event_line_broadcasts, 1 event = 1 行) に紐づけて保持する join
 * テーブル。
 *
 * 多選択 + FK 整合 + 添付削除時のカスケードのため、配列列ではなく join
 * テーブルにする。event_line_broadcasts は 1 大会 1 行で、招待コード再発行は
 * 同一行 UPDATE (id 保持) なので、この選択は再発行をまたいで保持される。
 * 紐付け完了 (status='linked') 時に、選択済みの添付だけが署名 URL リンクとして
 * LINE グループへ push される (broadcast-guidelines-on-link)。
 *
 * どちらの FK も ON DELETE CASCADE:
 *   - event_line_broadcast_id: 連携行が消えれば選択の意味も消える。
 *   - mail_attachment_id: 元の添付が消えたら送る対象が無いので選択も落とす。
 *
 * UNIQUE (event_line_broadcast_id, mail_attachment_id): 同じ添付を二重選択
 * できない (トグル保存の冪等性)。
 */
export const eventBroadcastGuidelineAttachments = pgTable(
  'event_broadcast_guideline_attachments',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventLineBroadcastId: integer('event_line_broadcast_id')
      .notNull()
      .references(() => eventLineBroadcasts.id, { onDelete: 'cascade' }),
    mailAttachmentId: integer('mail_attachment_id')
      .notNull()
      .references(() => mailAttachments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('event_broadcast_guideline_attachments_uq').on(
      t.eventLineBroadcastId,
      t.mailAttachmentId,
    ),
    // mail_attachment_id 側の FK (ON DELETE CASCADE) 用インデックス。UNIQUE は
    // 先頭列 event_line_broadcast_id にしか効かないため、添付/メール削除時の
    // カスケード探索が全走査にならないよう別途張る（既存 mail_attachments・
    // attachment_share_tokens と同じ慣習）。
    index('event_broadcast_guideline_attachments_mail_attachment_idx').on(
      t.mailAttachmentId,
    ),
  ],
)
