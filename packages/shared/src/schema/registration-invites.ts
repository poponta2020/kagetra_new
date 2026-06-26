import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth'

/**
 * registration_invites: admin-issued self-registration links.
 *
 * An admin/vice_admin issues a link from the member admin page; the URL carries
 * the high-entropy `token` (`crypto.randomBytes(32).toString('base64url')`). A
 * new member opens `/register/<token>`, logs in with LINE, and self-registers a
 * `role='member'` row (`line_link_method='invite_link'`).
 *
 * One link is reusable by multiple people while valid — there is deliberately
 * NO per-person/usage cap (distribution is operator-limited, see requirements
 * §6). A link is valid only while `revoked_at IS NULL AND now() < expires_at`;
 * both the page render and the submit action re-check this, so an open tab that
 * crosses the expiry cannot still register.
 *
 * `revoked_at` is a manual safety valve for mis-distribution (not a required
 * guard — expiry is the primary one). No FK back from `users` is kept: the
 * registration audit trail is `users.line_link_method='invite_link'`, which is
 * sufficient and avoids coupling member rows to ephemeral invite rows.
 */
export const registrationInvites = pgTable('registration_invites', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
})
