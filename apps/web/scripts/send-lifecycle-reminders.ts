#!/usr/bin/env tsx
/**
 * Daily lifecycle reminder sweep for event-lifecycle-notify.
 *
 * Runs at 00:00 JST (systemd timer) and pushes the 6 reminder notification
 * types to linked participant groups, once-ever per (event, type):
 *   - 申込締切    事前 (today+lead) / 当日 (today)   — 未申込のみ
 *   - 事前支払締切 事前 / 当日                        — payment_type='advance' かつ未払
 *   - 現地払い    事前 / 当日 (event_date 起点)       — payment_type='onsite'
 *
 * Preconditions (requirements §3.2.2): the event has a linked LINE group, is
 * not cancelled, and the relevant date column is non-NULL (enforced implicitly
 * by the equality — NULL never matches). The UNIQUE on
 * event_lifecycle_notifications makes a same-day re-run a no-op.
 *
 * Failed pushes are best-effort and NOT retried: the date condition falls out
 * of range tomorrow (§3.2.3).
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/send-lifecycle-reminders.ts [--dry-run]
 *
 *   --dry-run lists the candidates WITHOUT claiming the once-ever slot or
 *   pushing — safe for ops verification (does not consume the notification).
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq, isNotNull, ne, type SQL } from 'drizzle-orm'
import { events, eventLineBroadcasts } from '@kagetra/shared/schema'
import * as schema from '@kagetra/shared/schema'
import {
  addDaysIso,
  buildLifecycleMessage,
  jstTodayIso,
  reminderLeadDays,
  sendReminderNotification,
  type LifecycleNotificationType,
} from '../src/lib/event-lifecycle-notify'

// Exactly the db type the lib functions expect — guarantees assignability.
type Db = Parameters<typeof sendReminderNotification>[0]

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

export interface ReminderCandidate {
  eventId: number
  type: LifecycleNotificationType
  message: string
}

export interface LifecycleReminderResult {
  date: string
  leadDays: number
  sent: number
  skipped: number
  failed: number
  details: Array<{ eventId: number; type: LifecycleNotificationType; outcome: string }>
}

interface LinkedEventRow {
  id: number
  title: string
  feeJpy: number | null
  entryDeadline: string | null
  paymentDeadline: string | null
  eventDate: string
}

/**
 * Linked, non-cancelled events matching `condition`. The INNER JOIN on a
 * `status='linked'` binding with a non-null group enforces precondition §3.2.2#1.
 */
async function queryLinkedEvents(db: Db, condition: SQL | undefined): Promise<LinkedEventRow[]> {
  return db
    .select({
      id: events.id,
      title: events.title,
      feeJpy: events.feeJpy,
      entryDeadline: events.entryDeadline,
      paymentDeadline: events.paymentDeadline,
      eventDate: events.eventDate,
    })
    .from(events)
    .innerJoin(
      eventLineBroadcasts,
      and(
        eq(eventLineBroadcasts.eventId, events.id),
        eq(eventLineBroadcasts.status, 'linked'),
        isNotNull(eventLineBroadcasts.lineGroupId),
      ),
    )
    .where(and(ne(events.status, 'cancelled'), condition))
}

/**
 * Collect the (event, type, message) tuples to send today. Read-only — does
 * not claim or push, so it's safe to call from --dry-run.
 */
export async function collectReminderCandidates(
  db: Db,
  opts: { today: string; advanceDate: string; leadDays: number },
): Promise<ReminderCandidate[]> {
  const { today, advanceDate, leadDays } = opts
  const out: ReminderCandidate[] = []

  // 申込締切（事前 / 当日）— 未申込のみ
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.entryStatus, 'not_applied'), eq(events.entryDeadline, advanceDate)),
  )) {
    out.push({
      eventId: e.id,
      type: 'entry_deadline_advance',
      message: buildLifecycleMessage('entry_deadline_advance', {
        title: e.title,
        dateIso: e.entryDeadline ?? advanceDate,
        leadDays,
      }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.entryStatus, 'not_applied'), eq(events.entryDeadline, today)),
  )) {
    out.push({
      eventId: e.id,
      type: 'entry_deadline_day',
      message: buildLifecycleMessage('entry_deadline_day', {
        title: e.title,
        dateIso: e.entryDeadline ?? today,
      }),
    })
  }

  // 事前支払締切（事前 / 当日）— payment_type='advance' かつ未払のみ
  for (const e of await queryLinkedEvents(
    db,
    and(
      eq(events.paymentType, 'advance'),
      eq(events.paymentStatus, 'unpaid'),
      eq(events.paymentDeadline, advanceDate),
    ),
  )) {
    out.push({
      eventId: e.id,
      type: 'payment_deadline_advance',
      message: buildLifecycleMessage('payment_deadline_advance', {
        title: e.title,
        dateIso: e.paymentDeadline ?? advanceDate,
        leadDays,
      }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(
      eq(events.paymentType, 'advance'),
      eq(events.paymentStatus, 'unpaid'),
      eq(events.paymentDeadline, today),
    ),
  )) {
    out.push({
      eventId: e.id,
      type: 'payment_deadline_day',
      message: buildLifecycleMessage('payment_deadline_day', {
        title: e.title,
        dateIso: e.paymentDeadline ?? today,
      }),
    })
  }

  // 現地払い（事前 / 当日）— payment_type='onsite'、event_date 起点
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.paymentType, 'onsite'), eq(events.eventDate, advanceDate)),
  )) {
    out.push({
      eventId: e.id,
      type: 'onsite_payment_advance',
      message: buildLifecycleMessage('onsite_payment_advance', {
        title: e.title,
        feeJpy: e.feeJpy,
        dateIso: e.eventDate,
        leadDays,
      }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.paymentType, 'onsite'), eq(events.eventDate, today)),
  )) {
    out.push({
      eventId: e.id,
      type: 'onsite_payment_day',
      message: buildLifecycleMessage('onsite_payment_day', {
        title: e.title,
        feeJpy: e.feeJpy,
        dateIso: e.eventDate,
      }),
    })
  }

  return out
}

/**
 * Collect today's candidates and send each once-ever. `today` / `leadDays` are
 * injectable for deterministic tests.
 */
export async function sendLifecycleReminders(
  db: Db,
  options: { today?: string; leadDays?: number; logger?: Logger } = {},
): Promise<LifecycleReminderResult> {
  const today = options.today ?? jstTodayIso()
  const leadDays = options.leadDays ?? reminderLeadDays()
  const advanceDate = addDaysIso(today, leadDays)

  const candidates = await collectReminderCandidates(db, { today, advanceDate, leadDays })

  let sent = 0
  let skipped = 0
  let failed = 0
  const details: LifecycleReminderResult['details'] = []
  for (const candidate of candidates) {
    const result = await sendReminderNotification(db, candidate, { logger: options.logger })
    if (result.outcome === 'sent') sent++
    else if (result.outcome === 'failed') failed++
    else skipped++
    details.push({ eventId: candidate.eventId, type: candidate.type, outcome: result.outcome })
  }

  return { date: today, leadDays, sent, skipped, failed, details }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool, { schema })

    if (dryRun) {
      const today = jstTodayIso()
      const leadDays = reminderLeadDays()
      const advanceDate = addDaysIso(today, leadDays)
      const candidates = await collectReminderCandidates(db, { today, advanceDate, leadDays })
      process.stdout.write(
        `[send-lifecycle-reminders] DRY RUN (today=${today}, lead=${leadDays}, advance=${advanceDate}): ` +
          `${candidates.length} candidate(s)\n`,
      )
      for (const c of candidates) {
        process.stdout.write(`  - event ${c.eventId} [${c.type}] ${c.message}\n`)
      }
      return
    }

    const logger: Logger = {
      info: (msg, ctx) =>
        process.stdout.write(`[send-lifecycle-reminders] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
      warn: (msg, ctx) =>
        process.stderr.write(`[send-lifecycle-reminders] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
    }
    const result = await sendLifecycleReminders(db, { logger })
    process.stdout.write(
      `[send-lifecycle-reminders] today=${result.date} lead=${result.leadDays}: ` +
        `sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}\n`,
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
        `[send-lifecycle-reminders] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
