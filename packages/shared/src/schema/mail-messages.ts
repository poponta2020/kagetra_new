import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { mailMessageStatusEnum, mailClassificationEnum, mailTriageStatusEnum } from './enums'
import { users } from './auth'
import { events } from './events'

/**
 * mail_messages: 1 received e-mail = 1 row.
 *
 * Populated by `apps/mail-worker` via Yahoo!IMAP fetch (PR1). De-duplicated on
 * `messageId` (RFC 5322 Message-ID header), so identical re-fetches do not
 * insert duplicates.
 *
 * `classification` stays nullable until AI extraction runs (PR3); pre-filtered
 * mails (List-Unsubscribe, Auto-Submitted, etc.) are persisted with
 * `classification='noise'` directly so the inbox UI can suppress them.
 *
 * Downstream FKs (mail_attachments, tournament_drafts) arrive in PR2/PR3.
 */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    messageId: text('message_id').notNull().unique(),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses').array().notNull(),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { mode: 'date', withTimezone: true }).notNull(),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    status: mailMessageStatusEnum('status').notNull().default('pending'),
    classification: mailClassificationEnum('classification'),
    imapUid: integer('imap_uid'),
    imapBox: text('imap_box'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    // mail-triage-badge: 人手の処理状態。AI/技術状態の `status` とは直交する
    // （status='ai_done' でも未処理＝管理者が未対応、はあり得る）。未処理バッジ
    // 件数は triageStatus != 'processed'（= unprocessed）で算出。
    // mail-inbox-mailer: 2 状態化（unprocessed / processed）。
    triageStatus: mailTriageStatusEnum('triage_status').notNull().default('unprocessed'),
    triagedAt: timestamp('triaged_at', { mode: 'date', withTimezone: true }),
    // 処理者。ユーザー削除でもメール履歴は残すので onDelete: set null。
    triagedByUserId: text('triaged_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    // mail-inbox-mailer: 「組合せ表」「会場案内」「訂正版」などを既存大会に紐付ける
    // 際の FK。1 メール = 1 イベントの単純設計（中間テーブルにしない）。
    // AI 抽出経路（tournament_drafts.event_id / events.tournament_draft_id）
    // とは別 carrier。events 削除時は紐付けだけ外す（メール本体は履歴として残す）。
    linkedEventId: integer('linked_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    // Inbox UI lists newest-first; without this index the sort scans the full
    // table once mail volume grows. Status / classification filters added in
    // later PRs will also benefit from the receivedAt order being indexed.
    index('mail_messages_received_at_desc_idx').on(t.receivedAt.desc()),
    // mail-triage-badge: 未処理カウント / 区分フィルタ用。inbox の未処理バッジは
    // triageStatus で絞り込むので件数クエリが全表スキャンにならないよう index。
    index('mail_messages_triage_status_idx').on(t.triageStatus),
    // mail-inbox-mailer: events 詳細の「関連メール」セクションは linked_event_id
    // で逆引き。partial index で NULL 行を index から除外（NULL の方が多い前提）。
    index('mail_messages_linked_event_id_idx')
      .on(t.linkedEventId)
      .where(sql`${t.linkedEventId} IS NOT NULL`),
  ],
)
