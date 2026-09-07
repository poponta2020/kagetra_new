import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { mailMessages } from './mail-messages'

/**
 * mail_body_share_tokens: 60-day public URLs for the full text of a mail body.
 *
 * mail-body-as-image (2026-09 改修): 本文は LINE へ Flex カード 1 通で送り、
 * カードのタップで公開ページ `/mail-share/[token]` を開く。トークンは
 * `attachment_share_tokens` と同形・同条件 (32-character URL-safe random,
 * 60 日 TTL) で、`cleanup-expired-tokens.ts` が期限 +7 日の猶予で削除する。
 *
 * Authn-free by spec: LINE グループには景虎にログインできない非会員
 * (他会の応援者等) が含まれる。推測不能なトークンと 60 日の期限だけが防御。
 *
 * `access_count` は情報用途のみ (クローラ流出等の異常検知)。認可判断には
 * 使わない。
 */
export const mailBodyShareTokens = pgTable(
  'mail_body_share_tokens',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // 1 メールにつき常に 1 行。attachment_share_tokens と同じく
    // getOrCreateMailBodyShareToken が INSERT ... ON CONFLICT で
    // 「期限内は既存 token 維持 / 期限切れは再生成」を行うため、
    // UNIQUE が無いと古い token が残って URL が一意でなくなる。
    mailMessageId: integer('mail_message_id')
      .notNull()
      .unique()
      .references(() => mailMessages.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    accessCount: integer('access_count').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('mail_body_share_tokens_mail_idx').on(t.mailMessageId),
    // Drives the daily cleanup job's range scan.
    index('mail_body_share_tokens_expires_at_idx').on(t.expiresAt),
  ],
)
