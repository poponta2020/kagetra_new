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
  releasedCount: number
  releasedBroadcastIds: number[]
}

/**
 * Pure function — exported so unit tests can drive it with the test DB.
 */
export async function releaseExpiredBroadcasts(
  db: ReturnType<typeof drizzle<typeof schema>>,
  options: { dryRun?: boolean; today?: string } = {},
): Promise<ReleaseExpiredResult> {
  // Calendar comparison stays in the DB so we don't drift across timezones
  // — the events.event_date column is plain date (YYYY-MM-DD) and we
  // want "today in UTC" to match what the data was authored against.
  const today = options.today ?? new Date().toISOString().slice(0, 10)

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

  if (options.dryRun || expired.length === 0) {
    return {
      releasedCount: expired.length,
      releasedBroadcastIds: expired.map((row) => row.id),
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
  })

  return {
    releasedCount: expired.length,
    releasedBroadcastIds: expired.map((row) => row.id),
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
      `[release-expired-broadcasts] ${dryRun ? 'DRY RUN: ' : ''}released ${result.releasedCount} broadcasts ` +
        `(ids: ${result.releasedBroadcastIds.join(',') || 'none'})\n`,
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
