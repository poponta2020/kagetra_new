import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { mailAttachments } from './mail-attachments'

/**
 * attachment_share_tokens: 60-day public download URLs for mail_attachments.
 *
 * Tokens are 32-character URL-safe randoms (`crypto.randomBytes(24).toString
 * ('base64url')`), issued when an attachment is delivered via LINE Flex
 * Message fallback (Excel-by-design, image-render failure, 30+ page cap).
 *
 * Authn-free by spec: LINE groups host non-account guests (away-team
 * supporters etc.) who still need the attachment. Security relies on the
 * unguessable token + the 60-day expiry. `cleanup-expired-tokens.ts` purges
 * rows past expiry + 7 day grace.
 *
 * `access_count` is informational only — used to spot abnormal access
 * patterns (e.g. token leaked to crawlers). Not part of any auth decision.
 */
export const attachmentShareTokens = pgTable(
  'attachment_share_tokens',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // r-final-4 should_fix: 1 attachment に対して常に 1 行を維持するため
    // DB 層で UNIQUE を保証。getOrCreateShareToken は最新行を UPDATE で
    // 再生成するロジックを前提にしているが、過去データや並行発行で
    // 複数行ができると古い token が残り「再発行時に前 token 即失効」が
    // 成立しない。UNIQUE を入れて DB 制約で守る。
    mailAttachmentId: integer('mail_attachment_id')
      .notNull()
      .unique()
      .references(() => mailAttachments.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    accessCount: integer('access_count').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('attachment_share_tokens_attachment_idx').on(t.mailAttachmentId),
    // Drives the daily cleanup job's range scan.
    index('attachment_share_tokens_expires_at_idx').on(t.expiresAt),
  ],
)
