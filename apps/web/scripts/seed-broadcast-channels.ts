#!/usr/bin/env tsx
/**
 * Bootstrap the 30-Bot pool for the event-line-broadcast feature.
 *
 * Usage (from repo root, on the production host once 30 Bots are minted in
 * the LINE Developers Console):
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/seed-broadcast-channels.ts --file=/etc/kagetra/broadcast-channels.json
 *
 * Input JSON shape (array, one entry per Bot):
 *   [
 *     {
 *       "channelId":             "1234567890",
 *       "channelSecret":         "deadbeef...",
 *       "channelAccessToken":    "...",
 *       "botId":                 "@kagetra-event-bot-1",
 *       "webhookDestinationId":  "U0123456789abcdef0123456789abcdef",
 *       "note":                  "kagetra-event-bot-1"   // optional
 *     },
 *     ...
 *   ]
 *
 *   `webhookDestinationId` is the Bot's USER ID (the `destination` value
 *   LINE puts in every webhook payload). It is REQUIRED for webhook routing
 *   to work — without it the handler falls back to botId/channelId, which
 *   only matches in legacy / pre-rollout test setups.
 *
 * Idempotency:
 *   - INSERT rows whose `channel_id` is not yet present, with
 *     purpose='event_broadcast', status='available'.
 *   - Existing channel_id rows are skipped untouched — we never overwrite
 *     a credential the operator may have rotated by hand. To force-update,
 *     delete the row in psql first.
 *
 * The script is intentionally silent on credential validation (we don't
 * call the LINE API here). Smoke testing the Bot lives in
 * `/admin/line-channels/[id]` once the row is inserted.
 */

import { config as loadEnv } from 'dotenv'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { inArray } from 'drizzle-orm'
import { lineChannels } from '@kagetra/shared/schema'

export interface BroadcastChannelInput {
  channelId: string
  channelSecret: string
  channelAccessToken: string
  botId: string
  /** LINE Bot user ID (`U` + 32 hex) — required for webhook routing. */
  webhookDestinationId?: string
  note?: string
}

export type SeedBroadcastChannelOutcome =
  | { kind: 'inserted'; channelId: string; rowId: number }
  | { kind: 'skipped'; channelId: string; reason: 'already_exists' }

export interface SeedBroadcastChannelsResult {
  outcomes: SeedBroadcastChannelOutcome[]
  insertedCount: number
  skippedCount: number
}

/**
 * Idempotently insert broadcast Bots, skipping rows whose `channel_id` is
 * already present. Exported as a pure function so vitest can drive it with
 * the test DB connection.
 */
export async function seedBroadcastChannels(
  db: ReturnType<typeof drizzle>,
  inputs: readonly BroadcastChannelInput[],
): Promise<SeedBroadcastChannelsResult> {
  if (inputs.length === 0) {
    return { outcomes: [], insertedCount: 0, skippedCount: 0 }
  }

  // Pre-fetch existing channel_ids in a single query — cheaper than per-row
  // ON CONFLICT for a one-shot bootstrap, and gives us a clean "skipped"
  // signal for the operator log.
  const existing = await db
    .select({ channelId: lineChannels.channelId })
    .from(lineChannels)
    .where(
      inArray(
        lineChannels.channelId,
        inputs.map((row) => row.channelId),
      ),
    )
  const existingSet = new Set(existing.map((row) => row.channelId))

  const outcomes: SeedBroadcastChannelOutcome[] = []
  for (const [index, input] of inputs.entries()) {
    if (existingSet.has(input.channelId)) {
      outcomes.push({
        kind: 'skipped',
        channelId: input.channelId,
        reason: 'already_exists',
      })
      continue
    }
    const inserted = await db
      .insert(lineChannels)
      .values({
        channelId: input.channelId,
        channelSecret: input.channelSecret,
        channelAccessToken: input.channelAccessToken,
        botId: input.botId,
        webhookDestinationId: input.webhookDestinationId ?? null,
        purpose: 'event_broadcast',
        status: 'available',
        note: input.note ?? `kagetra-event-bot-${index + 1}`,
      })
      .returning({ id: lineChannels.id })
    const row = inserted[0]
    if (!row) throw new Error(`Failed to insert channel ${input.channelId}`)
    outcomes.push({ kind: 'inserted', channelId: input.channelId, rowId: row.id })
  }

  return {
    outcomes,
    insertedCount: outcomes.filter((o) => o.kind === 'inserted').length,
    skippedCount: outcomes.filter((o) => o.kind === 'skipped').length,
  }
}

interface ParsedArgs {
  filePath: string
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let filePath: string | null = null
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (!m) continue
    const [, key, value] = m
    if (key === 'file') filePath = value!
  }
  if (!filePath) {
    throw new Error('--file=<path> is required (JSON array of broadcast channel credentials)')
  }
  return { filePath }
}

function parseInputFile(filePath: string): BroadcastChannelInput[] {
  const raw = readFileSync(filePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array at top level of ${filePath}`)
  }
  return parsed.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`Entry ${index} is not an object`)
    }
    const obj = row as Record<string, unknown>
    const required = ['channelId', 'channelSecret', 'channelAccessToken', 'botId'] as const
    for (const key of required) {
      if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
        throw new Error(`Entry ${index} missing required field "${key}"`)
      }
    }
    return {
      channelId: obj.channelId as string,
      channelSecret: obj.channelSecret as string,
      channelAccessToken: obj.channelAccessToken as string,
      botId: obj.botId as string,
      webhookDestinationId:
        typeof obj.webhookDestinationId === 'string'
          ? obj.webhookDestinationId
          : undefined,
      note: typeof obj.note === 'string' ? obj.note : undefined,
    }
  })
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { filePath } = parseArgs(argv)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const inputs = parseInputFile(filePath)
  if (inputs.length === 0) {
    process.stdout.write('[seed-broadcast-channels] no rows in input file, nothing to do\n')
    return
  }

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool)
    const { outcomes, insertedCount, skippedCount } = await seedBroadcastChannels(db, inputs)
    for (const outcome of outcomes) {
      if (outcome.kind === 'inserted') {
        process.stdout.write(
          `[seed-broadcast-channels] inserted ${outcome.channelId} (row id=${outcome.rowId})\n`,
        )
      } else {
        process.stdout.write(
          `[seed-broadcast-channels] skipped ${outcome.channelId} (${outcome.reason})\n`,
        )
      }
    }
    process.stdout.write(
      `[seed-broadcast-channels] done: ${insertedCount} inserted, ${skippedCount} skipped\n`,
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
        `[seed-broadcast-channels] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
