#!/usr/bin/env tsx
/**
 * Daily release sweep for event-line-broadcast.
 *
 * Walks every `event_line_broadcasts` row in status='linked' whose effective
 * cutoff date has passed and:
 *   1. flips event_line_broadcasts.status → 'released', stamps released_at
 *   2. flips the channel back to status='available', clears assigned_event_id
 *
 * The cutoff is `COALESCE(event_line_broadcasts.extended_until,
 * events.event_date + 30 days)` — the 30-day grace lets打ち上げ / 反省連絡
 * chatter ride after the tournament ends, with operator override via
 * `extendBroadcastLifetime`.
 *
 * Run as a daily systemd timer on the production host. Idempotent: a
 * second run within the same day finds nothing left to release.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/release-expired-broadcasts.ts [--dry-run]
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq, sql } from 'drizzle-orm'
import {
  eventLineBroadcasts,
  events,
  lineChannels,
} from '@kagetra/shared/schema'
import * as schema from '@kagetra/shared/schema'

export interface ReleaseExpiredResult {
  /** linked → released で解放した件数 (大会終了 +30 日経過分) */
  releasedCount: number
  releasedBroadcastIds: number[]
  /**
   * invite_pending / joined_waiting_code → revoked で解放した件数。
   * r2 review should_fix: 招待コード期限切れ後も `assigned` のまま残る
   * Bot をプールに返却する。
   */
  revokedExpiredInviteCount: number
  revokedBroadcastIds: number[]
}

/**
 * Pure function — exported so unit tests can drive it with the test DB.
 */
/**
 * "Today" in JST. The systemd timer runs at 04:00 JST and event_date は
 * 日本のカレンダー基準で著者付けされている。UTC 基準で計算すると 04:00 JST
 * = 19:00 UTC (前日) になり、release 判定が 1 日遅れる (r3 review
 * should_fix)。`sv-SE` ロケールは YYYY-MM-DD を生成する慣用テクニック。
 */
function todayInJst(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

export async function releaseExpiredBroadcasts(
  db: ReturnType<typeof drizzle<typeof schema>>,
  options: { dryRun?: boolean; today?: string } = {},
): Promise<ReleaseExpiredResult> {
  // events.event_date は JST カレンダーで著者付けされた YYYY-MM-DD なので、
  // 比較対象の today も JST に揃える。テストは options.today で固定値を
  // 注入できる (deterministic)。
  const today = options.today ?? todayInJst()

  const expired = await db
    .select({
      id: eventLineBroadcasts.id,
      lineChannelId: eventLineBroadcasts.lineChannelId,
    })
    .from(eventLineBroadcasts)
    .innerJoin(events, eq(events.id, eventLineBroadcasts.eventId))
    .where(
      and(
        eq(eventLineBroadcasts.status, 'linked'),
        // `COALESCE(extended_until, event_date + 30) < today` — the
        // standard 30-day grace, with operator override taking precedence.
        sql`COALESCE(${eventLineBroadcasts.extendedUntil}, ${events.eventDate} + INTERVAL '30 days') < ${today}`,
      ),
    )

  // r2 review should_fix: 期限切れの invite_pending / joined_waiting_code
  // も同じバッチで一掃する。30 分 TTL の招待コードが過ぎても放置されると
  // line_channels.status='assigned' が永続化し、Bot プールが枯渇する。
  const expiredInvites = await db
    .select({
      id: eventLineBroadcasts.id,
      lineChannelId: eventLineBroadcasts.lineChannelId,
    })
    .from(eventLineBroadcasts)
    .where(
      and(
        sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
        sql`${eventLineBroadcasts.inviteCodeExpiresAt} IS NOT NULL`,
        sql`${eventLineBroadcasts.inviteCodeExpiresAt} < now()`,
      ),
    )

  if (options.dryRun || (expired.length === 0 && expiredInvites.length === 0)) {
    return {
      releasedCount: expired.length,
      releasedBroadcastIds: expired.map((row) => row.id),
      revokedExpiredInviteCount: expiredInvites.length,
      revokedBroadcastIds: expiredInvites.map((row) => row.id),
    }
  }

  await db.transaction(async (tx) => {
    for (const row of expired) {
      await tx
        .update(eventLineBroadcasts)
        .set({
          status: 'released',
          releasedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(eventLineBroadcasts.id, row.id))

      await tx
        .update(lineChannels)
        .set({
          status: 'available',
          assignedEventId: null,
          updatedAt: sql`now()`,
        })
        .where(eq(lineChannels.id, row.lineChannelId))
    }

    for (const row of expiredInvites) {
      await tx
        .update(eventLineBroadcasts)
        .set({
          status: 'revoked',
          revokedAt: sql`now()`,
          revokeReason: 'invite_expired',
          inviteCode: null,
          inviteCodeExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(eventLineBroadcasts.id, row.id))

      await tx
        .update(lineChannels)
        .set({
          status: 'available',
          assignedEventId: null,
          updatedAt: sql`now()`,
        })
        .where(eq(lineChannels.id, row.lineChannelId))
    }
  })

  return {
    releasedCount: expired.length,
    releasedBroadcastIds: expired.map((row) => row.id),
    revokedExpiredInviteCount: expiredInvites.length,
    revokedBroadcastIds: expiredInvites.map((row) => row.id),
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool, { schema })
    const result = await releaseExpiredBroadcasts(db, { dryRun })
    process.stdout.write(
      `[release-expired-broadcasts] ${dryRun ? 'DRY RUN: ' : ''}` +
        `released ${result.releasedCount} broadcasts ` +
        `(ids: ${result.releasedBroadcastIds.join(',') || 'none'}), ` +
        `revoked ${result.revokedExpiredInviteCount} expired invites ` +
        `(ids: ${result.revokedBroadcastIds.join(',') || 'none'})\n`,
    )
  } finally {
    await pool.end()
  }
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(
        `[release-expired-broadcasts] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
