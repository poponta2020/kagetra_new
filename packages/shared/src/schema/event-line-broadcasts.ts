import { date, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { eventLineBroadcastStatusEnum } from './enums'
import { events } from './events'
import { lineChannels } from './line-channels'

/**
 * event_line_broadcasts: 1 tournament event = 1 LINE group binding.
 *
 * Lifecycle:
 *   invite_pending → (Bot joined group)         → joined_waiting_code
 *                 → (6-digit code spoken)       → linked
 *                 → (Bot kicked / manual)       → revoked
 *                 → (event_date + 30d elapsed)  → released
 *
 * `event_id` is UNIQUE: one event maps to at most one LINE group. Code
 * regeneration after expiry happens in-place (UPDATE same row); a fresh
 * group binding for the same event is also a same-row UPDATE.
 *
 * `line_channel_id` uses ON DELETE RESTRICT — the channel pool is provisioned
 * once and only ever toggles status, so we want a delete attempt to fail
 * loudly rather than orphan history.
 *
 * `invite_code` partial UNIQUE: collisions among active invite codes must be
 * impossible. The partial WHERE deliberately omits an expiry check — Postgres
 * partial indexes only accept IMMUTABLE predicates, and `now()` is volatile.
 * In practice the same row gets UPDATEd on regeneration so expired codes are
 * overwritten in place; even if a stale code lingered, the verify path
 * additionally checks `invite_code_expires_at > now()`.
 */
export const eventLineBroadcasts = pgTable(
  'event_line_broadcasts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventId: integer('event_id')
      .notNull()
      .unique()
      // r-final-9 blocker: 元は ON DELETE CASCADE だったが、LINE 連携
      // 中の event を直接 DELETE すると broadcast 行が消えて
      // line_channels.assigned_event_id だけ NULL に戻り、channel が
      // status='active'/'assigned' のまま「assignedEventId=NULL」の
      // ゴミ状態になりプールから永久に外れる。RESTRICT に変えて、
      // event 削除前に必ず revoke を経由させる (UI/Action 側で誘導)。
      .references(() => events.id, { onDelete: 'restrict' }),
    lineChannelId: integer('line_channel_id')
      .notNull()
      .references(() => lineChannels.id, { onDelete: 'restrict' }),
    inviteCode: text('invite_code'),
    inviteCodeExpiresAt: timestamp('invite_code_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    lineGroupId: text('line_group_id'),
    status: eventLineBroadcastStatusEnum('status').notNull().default('invite_pending'),
    linkedAt: timestamp('linked_at', { mode: 'date', withTimezone: true }),
    // Operator override: extend the auto-release deadline beyond
    // events.event_date + 30 days. NULL falls back to the default formula.
    extendedUntil: date('extended_until', { mode: 'string' }),
    releasedAt: timestamp('released_at', { mode: 'date', withTimezone: true }),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    // Free-form reason: "manual" / "bot_kicked" / "channel_disabled". Kept as
    // text rather than enum since this is operator-facing audit info and may
    // grow new values as edge cases surface.
    revokeReason: text('revoke_reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('event_line_broadcasts_invite_code_active_uq')
      .on(t.inviteCode)
      .where(sql`${t.inviteCode} IS NOT NULL`),
  ],
)
