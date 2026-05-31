#!/usr/bin/env tsx
/**
 * Daily cleanup of attachment_share_tokens that are past their expiry.
 *
 * 60-day TTL + 7-day grace: we delete rows whose `expires_at < now() - 7
 * days`. The grace handles the case where someone re-shared a link from
 * LINE just before expiry and the download landed slightly after — we
 * surface a 404 on the route but still want the row available for audit
 * for a week.
 *
 * Idempotent. Run as a daily systemd timer alongside
 * `release-expired-broadcasts.ts`.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/cleanup-expired-tokens.ts [--dry-run]
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { lt, sql } from 'drizzle-orm'
import { attachmentShareTokens } from '@kagetra/shared/schema'
import * as schema from '@kagetra/shared/schema'

/** Days after expiry before a row is eligible for deletion. */
const GRACE_DAYS = 7

export interface CleanupExpiredTokensResult {
  deletedCount: number
}

/**
 * Pure function exported for tests.
 */
export async function cleanupExpiredTokens(
  db: ReturnType<typeof drizzle<typeof schema>>,
  options: { dryRun?: boolean; graceDays?: number; now?: Date } = {},
): Promise<CleanupExpiredTokensResult> {
  const graceDays = options.graceDays ?? GRACE_DAYS
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000)

  if (options.dryRun) {
    const counted = await db
      .select({ id: attachmentShareTokens.id })
      .from(attachmentShareTokens)
      .where(lt(attachmentShareTokens.expiresAt, cutoff))
    return { deletedCount: counted.length }
  }

  const deleted = await db
    .delete(attachmentShareTokens)
    .where(lt(attachmentShareTokens.expiresAt, cutoff))
    .returning({ id: attachmentShareTokens.id })
  return { deletedCount: deleted.length }
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
    const result = await cleanupExpiredTokens(db, { dryRun })
    process.stdout.write(
      `[cleanup-expired-tokens] ${dryRun ? 'DRY RUN: ' : ''}deleted ${result.deletedCount} expired tokens\n`,
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
        `[cleanup-expired-tokens] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
