#!/usr/bin/env tsx
/**
 * Daily 会内締切超過アラート for entry-overdue-alert.
 *
 * Runs at 07:00 JST (systemd timer) and pushes ONE summary to the admin's
 * personal LINE (the `line_channels` row with `status='system'`) listing the
 * events whose 会内締切 (COALESCE(internal_deadline, entry_deadline)) has passed
 * while `entry_status` is still `not_applied`.
 *
 * Deliberately different from send-lifecycle-reminders.ts on all three axes:
 *   - 宛先:   管理者個人 (system_notify) vs 大会 LINE グループ
 *   - 冪等性: 毎日鳴る (通知ログ表を持たない) vs once-ever (UNIQUE(event,type))
 *   - 時刻:   07:00 JST vs 00:00 JST
 * Hence a separate script and a separate timer rather than a shared batch.
 *
 * Requires DATABASE_URL *and* PUBLIC_BASE_URL: the summary links each event
 * with an absolute URL so it is tappable in LINE. A missing PUBLIC_BASE_URL is
 * a hard error (exit 1) — sending a linkless alert would hide the misconfig.
 * A missing system_notify channel is NOT an error (exit 0 + warning), so an
 * environment that never provisioned one doesn't fail every morning.
 *
 * Usage:
 *   DATABASE_URL=postgres://... PUBLIC_BASE_URL=https://... \
 *     pnpm --filter @kagetra/web exec tsx scripts/send-entry-overdue-alert.ts [--dry-run]
 *
 *   --dry-run lists the candidates and the message WITHOUT pushing. Safe on
 *   production data — this alert has no once-ever slot to consume.
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { jstTodayIso } from '../src/lib/event-lifecycle-notify'
import {
  buildOverdueAlertMessage,
  collectOverdueEntries,
  sendEntryOverdueAlert,
} from '../src/lib/entry-overdue-alert'

// Exactly the db type the lib functions expect — guarantees assignability.
type Db = Parameters<typeof sendEntryOverdueAlert>[0]

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

/**
 * List today's candidates without pushing. Kept separate from the send path so
 * --dry-run never touches the LINE API, and so a missing PUBLIC_BASE_URL shows
 * up as a placeholder in the preview instead of aborting the inspection.
 */
export async function dryRun(
  db: Db,
  opts: { today?: string; baseUrl?: string } = {},
): Promise<{ today: string; candidateCount: number; message: string | null }> {
  const today = opts.today ?? jstTodayIso()
  const rows = await collectOverdueEntries(db, { today })
  if (rows.length === 0) return { today, candidateCount: 0, message: null }
  const baseUrl = opts.baseUrl ?? process.env.PUBLIC_BASE_URL ?? '(PUBLIC_BASE_URL 未設定)'
  return {
    today,
    candidateCount: rows.length,
    message: buildOverdueAlertMessage(rows, { today, baseUrl }),
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const isDryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool, { schema })

    if (isDryRun) {
      const result = await dryRun(db)
      process.stdout.write(
        `[send-entry-overdue-alert] DRY RUN (today=${result.today}): ` +
          `${result.candidateCount} candidate(s)\n`,
      )
      if (result.message) process.stdout.write(`${result.message}\n`)
      return
    }

    const logger: Logger = {
      info: (msg, ctx) =>
        process.stdout.write(
          `[send-entry-overdue-alert] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`,
        ),
      warn: (msg, ctx) =>
        process.stderr.write(
          `[send-entry-overdue-alert] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`,
        ),
    }
    const result = await sendEntryOverdueAlert(db, { logger })
    if ('skipped' in result) {
      process.stdout.write(`[send-entry-overdue-alert] skipped: ${result.skipped}\n`)
      return
    }
    process.stdout.write(
      `[send-entry-overdue-alert] ${result.candidateCount} candidate(s), ` +
        `push ${result.pushOutcome}\n`,
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
        `[send-entry-overdue-alert] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
