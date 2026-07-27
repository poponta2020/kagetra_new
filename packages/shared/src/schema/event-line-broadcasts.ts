import { date, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { eventLineBroadcastStatusEnum } from './enums'
import { entryGroups } from './entry-groups'
import { lineChannels } from './line-channels'

/**
 * event_line_broadcasts: 1 entry group = 1 LINE group binding.
 *
 * entry-groups: 帰属は **申込グループ**（旧: 個々の event）。実運用の LINE 連絡は
 * 「同じ案内メール × 同じ申込締切」のまとまり単位で行われるため（多摩 AB / CDE）、
 * 紐付け・配信・要綱・自動解放をグループ単位に集約した。
 *
 * Lifecycle:
 *   invite_pending → (Bot joined group)          → joined_waiting_code
 *                 → (6-digit code spoken)        → linked
 *                 → (Bot kicked / manual)        → revoked
 *                 → (グループ内最終開催日 + 30d) → released
 *
 * `entry_group_id` is UNIQUE: one group maps to at most one LINE group. Code
 * regeneration after expiry happens in-place (UPDATE same row); a fresh
 * group binding for the same entry group is also a same-row UPDATE.
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
    // entry-groups: 帰属を event → entry_group へ移した（1グループ=1LINEグループ=1Bot）。
    // グループ内のどの日の詳細画面から操作しても同一の紐付けに作用する（1回で全日に効く）。
    //
    // UNIQUE は「1グループにつき紐付け行は高々1つ」。**行再利用セマンティクスが前提**で、
    // コード再発行も新しいグループ紐付けも同一行の UPDATE で行うため、revoked/released の
    // 履歴が別行として溜まることはなく UNIQUE と両立する。
    //
    // RESTRICT の理由（r-final-9 blocker の経緯）: 親を直接 DELETE すると broadcast 行が
    // 消えて line_channels.assigned_* だけ NULL に戻り、channel が status='active'/'assigned'
    // のまま「assigned=NULL」のゴミ状態になりプールから永久に外れる。削除前に必ず revoke を
    // 経由させる。
    entryGroupId: integer('entry_group_id')
      .notNull()
      .unique()
      .references(() => entryGroups.id, { onDelete: 'restrict' }),
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
    // broadcast-guidelines-on-link: 紐付け完了 (linked) 時に、選択済みの
    // 要綱添付を LINE グループへ push した最終日時 (監査 + UI 表示用)。
    // 未送信・要綱未選択・招待コード再発行後 (binding リセット) は NULL。
    // 選択の実体は event_broadcast_guideline_attachments (join) が持つ。
    guidelinesSentAt: timestamp('guidelines_sent_at', {
      mode: 'date',
      withTimezone: true,
    }),
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
