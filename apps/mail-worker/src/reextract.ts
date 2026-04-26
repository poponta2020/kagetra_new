import { pathToFileURL } from 'node:url'
import { and, eq, gte, inArray, or } from 'drizzle-orm'
import { mailMessages } from '@kagetra/shared/schema'
import { closeDb, getDb, type Db } from './db.js'
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
 *      Pre-filter noise rows live as `status='fetched',
 *      classification='noise'` (the AI phase short-circuits on them at
 *      pipeline time), so they're outside the default selection. Pass
 *      `--include-prefilter-noise` to fold them in when a venue allow-list
 *      or sender-rule update means previously-rejected mails now deserve a
 *      look. The regular pipeline never re-fetches mails IMAP has already
 *      deleted, so the CLI is the only recovery path for these rows.
 *
 * Selection criteria:
 *   - `received_at >= --since` (a YYYY-MM-DD value resolves to JST 00:00)
 *   - `status IN ('ai_done', 'ai_failed', 'archived', 'ai_processing')` —
 *     terminal AI states (done/failed/archived) plus `ai_processing` to
 *     unstick rows whose worker crashed mid-call. The regular pipeline's
 *     duplicate path also retries `ai_processing` next run, so this is a
 *     belt-and-braces escape hatch for mails that won't be re-fetched
 *     (e.g. already deleted from IMAP). `'pending'` and `'fetched'` rows
 *     are owned by the regular pipeline EXCEPT when `--include-prefilter-noise`
 *     is set, which adds `(status='fetched' AND classification='noise')` to
 *     the WHERE clause.
 *
 * Each mail is run through `classifyMail(... { force: true })` so the
 * pre-filter `classification === 'noise'` short-circuit is bypassed. Drafts
 * are upserted via `persistOutcome` (same write path as the pipeline) so
 * status transitions stay consistent with normal runs. Drafts whose status
 * an admin has already set to `approved` / `rejected` are preserved; the
 * per-mail log surfaces this as `preserved` so operators can spot it.
 *
 * Per-mail errors are isolated: one failure logs and continues to the next
 * mail. The CLI exits with a non-zero code if any mail failed so cron-style
 * invocations can surface the partial failure.
 */
interface ReextractArgs {
  since: Date | null
  includePrefilterNoise: boolean
  help: boolean
}

const VALID_STATUSES = ['ai_done', 'ai_failed', 'archived', 'ai_processing'] as const

// `^YYYY-MM-DD$`. The format check is shape-only; we still round-trip the
// resulting Date back into JST y/m/d to catch values like `2026-04-31` that
// the JS `Date` constructor silently rolls into the next month (review r3
// Nit). `\d{4}` would also accept `9999`, which is fine — calendar dates
// only need to be syntactically well-formed; out-of-range years are an
// operator typo we accept rather than complicate the regex.
const SINCE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseArgs(argv: readonly string[]): ReextractArgs {
  const args: ReextractArgs = {
    since: null,
    includePrefilterNoise: false,
    help: false,
  }
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') {
      args.help = true
    } else if (a === '--include-prefilter-noise') {
      args.includePrefilterNoise = true
    } else if (a.startsWith('--since=')) {
      const v = a.slice('--since='.length)
      // Operators always pass a calendar day for re-extracts; the inline
      // `T00:00:00+09:00` parse keeps the CLI surface narrow. We refuse
      // ISO datetimes, missing zero-pads (`2026-4-1`), and out-of-range
      // calendar days (`2026-04-31`) here — all three used to slip through
      // because `new Date(...)` either NaN'd silently or auto-rolled the
      // overflow (review r3 Nit).
      const match = SINCE_DATE_RE.exec(v)
      if (!match) {
        throw new Error(`--since must be YYYY-MM-DD, got: ${v}`)
      }
      const [, yyyy, mm, dd] = match
      const date = new Date(`${v}T00:00:00+09:00`)
      // Round-trip back through JST y/m/d to reject `2026-04-31` (which
      // `Date` accepts and rolls forward to 2026-05-01). We compare the
      // JST-local components rather than UTC ones — JST is the parsed
      // timezone, so a same-day round-trip means it's a real calendar day.
      const jst = jstYearMonthDay(date)
      if (
        Number.isNaN(date.getTime()) ||
        jst.year !== Number(yyyy) ||
        jst.month !== Number(mm) ||
        jst.day !== Number(dd)
      ) {
        throw new Error(`--since is not a valid calendar day: ${v}`)
      }
      args.since = date
    } else {
      // Unknown flag — fail loudly rather than silently no-op. Without this
      // a typo like `--include-prefiler-noise` would just be dropped and
      // the operator would think the run included pre-filter noise when it
      // didn't (review r3 Nit).
      throw new Error(`unknown flag: ${a}`)
    }
  }
  return args
}

/**
 * Extract JST (UTC+9) calendar y/m/d from a Date. Used to round-trip the
 * `--since` value back into the input shape — if the operator passes
 * `2026-04-31` and JS rolls it to `2026-05-01`, the components won't match.
 *
 * Implemented with `toLocaleString` so we don't pull in a tz library; the
 * `en-CA` locale renders as `YYYY-MM-DD HH:mm:ss`, which we split.
 */
function jstYearMonthDay(date: Date): {
  year: number
  month: number
  day: number
} {
  const ymd = date
    .toLocaleString('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .slice(0, 10) // strip any time component locales might append
  const [yearStr, monthStr, dayStr] = ymd.split('-')
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  }
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: tsx apps/mail-worker/src/reextract.ts --since=YYYY-MM-DD [--include-prefilter-noise]

Re-classifies all mails in (ai_done, ai_failed, archived, ai_processing) status
with received_at >= --since. The pre-filter noise check is bypassed
(force=true). Drafts are upserted (existing drafts get refreshed with the new
model output); drafts already approved or rejected by an admin are preserved.

  --include-prefilter-noise
      Also re-classify mails the pre-filter dropped early
      (status='fetched', classification='noise'). Use after a pre-filter rule
      change (venue allow-list, sender update, etc.) when previously-rejected
      mails should be evaluated by the AI. Default off — these rows are
      otherwise outside the selection.

Requires ANTHROPIC_API_KEY in env (loaded via dotenv from repo root).
`)
}

/**
 * Pick the set of `mail_messages` rows the operator wants AI to (re-)evaluate.
 *
 * Default selection covers AI-touched terminal states (`ai_done` / `ai_failed`
 * / `archived` / `ai_processing`). When `includePrefilterNoise` is set we
 * also fold in rows the PR1 pre-filter dropped — they sit at
 * `status='fetched'`, `classification='noise'` and the regular pipeline
 * intentionally never sends them to the LLM. After a venue allow-list or
 * sender-rule change they may now deserve a fresh look. Putting both legs in
 * a single OR keeps the SELECT to one round trip.
 *
 * Exported separately from the CLI entrypoint so tests can verify the
 * predicate without spinning up Anthropic.
 */
export async function selectReextractTargets(
  db: Db,
  args: { since: Date; includePrefilterNoise: boolean },
): Promise<Array<{ id: number; messageId: string; subject: string | null }>> {
  const statusClause = args.includePrefilterNoise
    ? or(
        inArray(mailMessages.status, [...VALID_STATUSES]),
        and(
          eq(mailMessages.status, 'fetched'),
          eq(mailMessages.classification, 'noise'),
        ),
      )
    : inArray(mailMessages.status, [...VALID_STATUSES])
  return db
    .select({
      id: mailMessages.id,
      messageId: mailMessages.messageId,
      subject: mailMessages.subject,
    })
    .from(mailMessages)
    .where(and(gte(mailMessages.receivedAt, args.since), statusClause))
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
    const targets = await selectReextractTargets(db, {
      since: args.since,
      includePrefilterNoise: args.includePrefilterNoise,
    })

    // eslint-disable-next-line no-console
    console.log(
      `[reextract] ${targets.length} mails since ${args.since.toISOString()}` +
        (args.includePrefilterNoise ? ' (incl. pre-filter noise)' : ''),
    )

    for (const t of targets) {
      try {
        const outcome = await classifyMail(db, t.id, llm, { force: true })
        const tally = await persistOutcome(db, t.id, outcome)
        // eslint-disable-next-line no-console
        console.log(
          `[reextract] [${t.id}] ${outcome.kind} (drafts: +${tally.draftsInserted} new, ${tally.draftsUpdated} updated, ${tally.draftsPreserved} preserved)`,
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
//
// `pathToFileURL` produces the canonical `file://` form for the current
// platform: `file:///C:/path/to/reextract.ts` on Windows,
// `file:///path/to/reextract.ts` on POSIX. Doing the slash count by hand
// (the previous implementation) got it wrong on Windows — `file://C:/...`
// vs `file:///C:/...` differ by one slash, so the guard never matched and
// the CLI silently exited 0 without doing anything (review r3 Should fix).
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
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
