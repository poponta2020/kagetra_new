import { and, gte, inArray } from 'drizzle-orm'
import { mailMessages } from '@kagetra/shared/schema'
import { closeDb, getDb } from './db.js'
import { classifyMail, persistOutcome } from './classify/classifier.js'
import { AnthropicSonnet46Extractor } from './classify/llm/anthropic.js'
import { loadLlmConfig } from './config.js'

/**
 * `reextract` CLI — re-run AI classification for previously-processed mails.
 *
 * Use cases:
 *   1. Prompt version bump (`PROMPT_VERSION` change) — refresh stale drafts.
 *   2. Model upgrade (e.g. Sonnet 4.6 → 4.7) — re-evaluate `ai_failed` rows.
 *   3. Pre-filter rule change — re-classify mails the worker dropped early.
 *
 * Selection criteria:
 *   - `received_at >= --since` (JST 00:00 if a date-only value is given)
 *   - `status IN ('ai_done', 'ai_failed', 'archived')` — these are the
 *     terminal states for which a re-extract is meaningful. `'pending'` and
 *     `'fetched'` will be picked up by the regular pipeline; `'ai_processing'`
 *     means a worker is mid-call and the operator should let it finish.
 *
 * Each mail is run through `classifyMail(... { force: true })` so the
 * pre-filter `classification === 'noise'` short-circuit is bypassed. Drafts
 * are upserted via `persistOutcome` (same write path as the pipeline) so
 * status transitions stay consistent with normal runs.
 *
 * Per-mail errors are isolated: one failure logs and continues to the next
 * mail. The CLI exits with a non-zero code if any mail failed so cron-style
 * invocations can surface the partial failure.
 */
interface ReextractArgs {
  since: Date | null
  help: boolean
}

const VALID_STATUSES = ['ai_done', 'ai_failed', 'archived'] as const

function parseArgs(argv: readonly string[]): ReextractArgs {
  const args: ReextractArgs = { since: null, help: false }
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') args.help = true
    else if (a.startsWith('--since=')) {
      const v = a.slice('--since='.length)
      // Match the main pipeline's --since semantics (JST start-of-day for a
      // bare YYYY-MM-DD). Re-uses the inline form to keep the CLI surface
      // small; cli-args.parseSinceArg also works for ISO datetimes — if the
      // operator hits the bare-date case in practice, that's enough coverage.
      const date = new Date(`${v}T00:00:00+09:00`)
      if (Number.isNaN(date.getTime())) {
        throw new Error(`--since must be YYYY-MM-DD, got: ${v}`)
      }
      args.since = date
    }
  }
  return args
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: tsx apps/mail-worker/src/reextract.ts --since=YYYY-MM-DD

Re-classifies all mails in (ai_done, ai_failed, archived) status with
received_at >= --since. The pre-filter noise check is bypassed (force=true).
Drafts are upserted (existing drafts get refreshed with the new model output).

Requires ANTHROPIC_API_KEY in env (loaded via dotenv from repo root).
`)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  if (args.help) {
    printUsage()
    return 0
  }
  if (!args.since) {
    printUsage()
    return 1
  }

  const llmConfig = loadLlmConfig()
  const llm = new AnthropicSonnet46Extractor({ apiKey: llmConfig.anthropicApiKey })
  const db = getDb()
  let failures = 0

  try {
    const targets = await db
      .select({
        id: mailMessages.id,
        messageId: mailMessages.messageId,
        subject: mailMessages.subject,
      })
      .from(mailMessages)
      .where(
        and(
          gte(mailMessages.receivedAt, args.since),
          inArray(mailMessages.status, [...VALID_STATUSES]),
        ),
      )

    // eslint-disable-next-line no-console
    console.log(
      `[reextract] ${targets.length} mails since ${args.since.toISOString()}`,
    )

    for (const t of targets) {
      try {
        const outcome = await classifyMail(db, t.id, llm, { force: true })
        const tally = await persistOutcome(db, t.id, outcome)
        // eslint-disable-next-line no-console
        console.log(
          `[reextract] [${t.id}] ${outcome.kind} (drafts: +${tally.draftsInserted} new, ${tally.draftsUpdated} updated)`,
        )
      } catch (err) {
        failures += 1
        // eslint-disable-next-line no-console
        console.error(
          `[reextract] [${t.id}] FAILED:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  } finally {
    await closeDb()
  }

  return failures > 0 ? 1 : 0
}

// Entrypoint guard. Equivalent to Python's `if __name__ == '__main__':` —
// allows tests to import this module without auto-running the CLI.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main()
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[reextract] fatal:', err)
      process.exit(1)
    })
}

export { main as runReextract, parseArgs as parseReextractArgs }
