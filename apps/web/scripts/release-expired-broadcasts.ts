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

  // rr2 review should_fix: 候補取得から UPDATE までを単一トランザクション
  // に入れて、間に別 tx が同じ channel を新 event に割当てるレースを防ぐ。
  // UPDATE の WHERE には現在の status・期限条件・assignedEventId 一致を
  // すべて含めて、選択時点と異なる行は更新しない (UPDATE が 0 行を返す)。

  const releasedBroadcastIds: number[] = []
  const revokedBroadcastIds: number[] = []

  // dry-run は副作用を起こさないので、これだけ DB トランザクション外で
  // 件数 estimate を返す (read-only)。
  if (options.dryRun) {
    const expiredDry = await db
      .select({ id: eventLineBroadcasts.id })
      .from(eventLineBroadcasts)
      .innerJoin(events, eq(events.id, eventLineBroadcasts.eventId))
      .where(
        and(
          eq(eventLineBroadcasts.status, 'linked'),
          sql`COALESCE(${eventLineBroadcasts.extendedUntil}, ${events.eventDate} + INTERVAL '30 days') < ${today}`,
        ),
      )
    const expiredInvitesDry = await db
      .select({ id: eventLineBroadcasts.id })
      .from(eventLineBroadcasts)
      .where(
        and(
          sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
          sql`${eventLineBroadcasts.inviteCodeExpiresAt} IS NOT NULL`,
          sql`${eventLineBroadcasts.inviteCodeExpiresAt} < now()`,
        ),
      )
    return {
      releasedCount: expiredDry.length,
      releasedBroadcastIds: expiredDry.map((row) => row.id),
      revokedExpiredInviteCount: expiredInvitesDry.length,
      revokedBroadcastIds: expiredInvitesDry.map((row) => row.id),
    }
  }

  await db.transaction(async (tx) => {
    // 1) 大会終了 +30 日経過の linked 行
    const expired = await tx
      .select({
        id: eventLineBroadcasts.id,
        eventId: eventLineBroadcasts.eventId,
        lineChannelId: eventLineBroadcasts.lineChannelId,
      })
      .from(eventLineBroadcasts)
      .innerJoin(events, eq(events.id, eventLineBroadcasts.eventId))
      .where(
        and(
          eq(eventLineBroadcasts.status, 'linked'),
          sql`COALESCE(${eventLineBroadcasts.extendedUntil}, ${events.eventDate} + INTERVAL '30 days') < ${today}`,
        ),
      )

    for (const row of expired) {
      // status='linked' 条件を WHERE に再掲。同じ tx 内なので race は起き
      // ないが、データ整合性のための defensive check (別 tx で revoke
      // されていた等)。
      //
      // r-final-6 should_fix: 期限条件 (COALESCE(extended_until, event_date
      // + 30) < today) を UPDATE WHERE にも再掲。SELECT と UPDATE の間に
      // 管理者が extended_until を延ばしていた場合でも、ここで再度判定し
      // 不一致なら更新しない。EXISTS サブクエリで events を参照する。
      const updated = await tx
        .update(eventLineBroadcasts)
        .set({
          status: 'released',
          releasedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(eventLineBroadcasts.id, row.id),
            eq(eventLineBroadcasts.status, 'linked'),
            sql`EXISTS (
              SELECT 1 FROM events e
              WHERE e.id = ${eventLineBroadcasts.eventId}
                AND COALESCE(${eventLineBroadcasts.extendedUntil}, e.event_date + INTERVAL '30 days') < ${today}
            )`,
          ),
        )
        .returning({ id: eventLineBroadcasts.id })
      if (updated.length === 0) continue

      // channel は「現在この event に紐付いている」場合のみ available へ。
      // 間に手動 revoke や再割当が走ったら、その channel は触らない。
      await tx
        .update(lineChannels)
        .set({
          status: 'available',
          assignedEventId: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lineChannels.id, row.lineChannelId),
            eq(lineChannels.assignedEventId, row.eventId),
          ),
        )
      releasedBroadcastIds.push(row.id)
    }

    // 2) 期限切れ invite_pending / joined_waiting_code
    const expiredInvites = await tx
      .select({
        id: eventLineBroadcasts.id,
        eventId: eventLineBroadcasts.eventId,
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

    for (const row of expiredInvites) {
      const updated = await tx
        .update(eventLineBroadcasts)
        .set({
          status: 'revoked',
          revokedAt: sql`now()`,
          revokeReason: 'invite_expired',
          inviteCode: null,
          inviteCodeExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(eventLineBroadcasts.id, row.id),
            sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
            sql`${eventLineBroadcasts.inviteCodeExpiresAt} < now()`,
          ),
        )
        .returning({ id: eventLineBroadcasts.id })
      if (updated.length === 0) continue

      await tx
        .update(lineChannels)
        .set({
          status: 'available',
          assignedEventId: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lineChannels.id, row.lineChannelId),
            eq(lineChannels.assignedEventId, row.eventId),
          ),
        )
      revokedBroadcastIds.push(row.id)
    }
  })

  return {
    releasedCount: releasedBroadcastIds.length,
    releasedBroadcastIds,
    revokedExpiredInviteCount: revokedBroadcastIds.length,
    revokedBroadcastIds,
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
