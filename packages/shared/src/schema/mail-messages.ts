import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { mailMessageStatusEnum, mailClassificationEnum, mailTriageStatusEnum } from './enums'
import { users } from './auth'

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
    // 件数は triageStatus != 'processed'（unprocessed + deferred）で算出。
    triageStatus: mailTriageStatusEnum('triage_status').notNull().default('unprocessed'),
    triagedAt: timestamp('triaged_at', { mode: 'date', withTimezone: true }),
    // 処理者。ユーザー削除でもメール履歴は残すので onDelete: set null。
    triagedByUserId: text('triaged_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Inbox UI lists newest-first; without this index the sort scans the full
    // table once mail volume grows. Status / classification filters added in
    // later PRs will also benefit from the receivedAt order being indexed.
    index('mail_messages_received_at_desc_idx').on(t.receivedAt.desc()),
    // mail-triage-badge: 未処理カウント / 区分フィルタ用。inbox の未処理バッジは
    // triageStatus で絞り込むので件数クエリが全表スキャンにならないよう index。
    index('mail_messages_triage_status_idx').on(t.triageStatus),
  ],
)
