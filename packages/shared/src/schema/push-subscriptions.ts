import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth'

/**
 * push_subscriptions: 1 ブラウザ/PWA エンドポイント = 1 row（mail-triage-badge）.
 *
 * Web Push の購読情報。管理者・副管理者が PWA で通知を許可すると pushManager の
 * subscription（endpoint + p256dh/auth 鍵）をここに保存する。1 ユーザー複数端末を
 * 許容するため user_id に UNIQUE は張らず、`endpoint` を UNIQUE にする（同一端末の
 * 再購読は endpoint 一致で upsert できる）。
 *
 * mail-worker が新着メール着信時にこの行を読み、web-push で各端末へ配信する。
 * 失効（HTTP 410/404）した購読は配信側が行を削除する。
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    // クライアントの PushSubscription.getKey() 由来の購読鍵（base64url）。
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { mode: 'date', withTimezone: true }),
  },
  (t) => [
    // 配信時に user_id（admin/vice_admin の購読）で引くので index。
    index('push_subscriptions_user_id_idx').on(t.userId),
  ],
)
