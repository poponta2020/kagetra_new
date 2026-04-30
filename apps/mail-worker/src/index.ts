import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOnce, runPipeline } from './pipeline.js'
import { FixtureMailSource } from './fetch/fetcher.js'
import { closeDb, getDb } from './db.js'
import { loadLogConfig, loadLlmConfig } from './config.js'
import { parseSinceArg } from './cli-args.js'
import {
  claimNextJob,
  markJobDone,
  markJobFailed,
  recoverStaleClaimedJobs,
} from './jobs.js'
import { FixtureLLMExtractor, loadFixturesFromDir } from './classify/llm/fixture.js'
import { AnthropicSonnet46Extractor } from './classify/llm/anthropic.js'
import type { LLMExtractor } from './classify/llm/types.js'
import type { ExtractionPayload } from './classify/schema.js'

interface CliFlags {
  /**
   * Currently a no-op — the worker always exits after one run. Parsed for
   * forward-compat with the `--watch` flag landing in PR5; keeps existing cron
   * invocations working unchanged once `--watch` ships.
   */
  once: boolean
  since: Date | undefined
  mockImap: boolean
  mockLlm: boolean
  dryRun: boolean
  /**
   * PR5: skip the `mail_worker_jobs` claim step and run a pure cron tick.
   * Used by tests / smoke / debug to exercise the legacy code path.
   */
  noClaim: boolean
  fixtureDir: string | undefined
}

/**
 * Default lookback for live IMAP when `--since` is omitted. Avoids the worst
 * case (full INBOX scan + body/attachment download) on a stray `pnpm start`.
 * 7 days is wide enough to catch a missed daily cron once and narrow enough
 * to keep memory and DB churn bounded.
 */
const LIVE_DEFAULT_SINCE_DAYS = 7

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    once: false,
    since: undefined,
    mockImap: false,
    mockLlm: false,
    dryRun: false,
    noClaim: false,
    fixtureDir: undefined,
  }
  for (const arg of argv) {
    if (arg === '--once') flags.once = true
    else if (arg === '--mock-imap') flags.mockImap = true
    else if (arg === '--mock-llm') flags.mockLlm = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--no-claim') flags.noClaim = true
    else if (arg.startsWith('--since=')) {
      const value = arg.slice('--since='.length)
      flags.since = parseSinceArg(value)
    } else if (arg.startsWith('--fixture-dir=')) {
      flags.fixtureDir = arg.slice('--fixture-dir='.length)
    } else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  return flags
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: mail-worker [flags]

  --once                 Run pipeline once and exit (P1 default; --watch is PR5).
  --since=YYYY-MM-DD     Only fetch mails received on/after this date (JST 00:00).
                         Pass an ISO datetime to use a sub-day cutoff. Datetimes
                         without an explicit offset are interpreted as JST
                         (e.g. 2026-04-12T15:00:00 == 2026-04-12T15:00:00+09:00),
                         so admins on a UTC host don't have to remember to append
                         "+09:00". Live IMAP defaults to the last
                         ${LIVE_DEFAULT_SINCE_DAYS} days when omitted.
  --mock-imap            Use fixture eml files instead of live IMAP.
  --mock-llm             Use FixtureLLMExtractor (loads test/fixtures/llm/*.expected.json)
                         instead of Anthropic. Skips ANTHROPIC_API_KEY validation.
  --fixture-dir=PATH     Directory of *.eml files for --mock-imap (default: ./test/fixtures).
  --dry-run              Parse only; do not write to DB or call the LLM.
  --no-claim             Skip mail_worker_jobs claim and run a pure cron tick (test/debug).
  --help, -h             Show this help.
`)
}

function defaultLiveSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - LIVE_DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000)
}

async function loadFixtureBuffers(dir: string): Promise<Array<{ source: Buffer }>> {
  const entries = await readdir(dir)
  const emls = entries.filter((name) => name.toLowerCase().endsWith('.eml'))
  return Promise.all(
    emls.sort().map(async (name) => ({
      source: await readFile(join(dir, name)),
    })),
  )
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))

  // Build the LLM extractor. Three branches:
  //   --dry-run    → no extractor (AI phase is skipped entirely)
  //   --mock-llm   → FixtureLLMExtractor (no ANTHROPIC_API_KEY required)
  //   default      → AnthropicSonnet46Extractor (loadLlmConfig validates env)
  const llmExtractor = await buildLlmExtractor(flags)

  // Build the IMAP source: `--mock-imap` reads fixture eml files; otherwise
  // we let `runPipeline` instantiate a `LiveMailSource` (via the default).
  let source: FixtureMailSource | undefined
  if (flags.mockImap) {
    const dir = flags.fixtureDir
      ?? join(fileURLToPath(new URL('..', import.meta.url)), 'test', 'fixtures')
    const fixtures = await loadFixtureBuffers(dir)
    source = new FixtureMailSource(fixtures)
  }

  // Default lookback for cron / live IMAP. Logged the first time we apply it
  // so operators know why a manual `pnpm start` looks at the last 7 days.
  const cronSince = flags.since ?? defaultLiveSince()
  if (!flags.since && !flags.mockImap) {
    // eslint-disable-next-line no-console
    console.log(
      `[mail-worker] --since not provided; defaulting to last ${LIVE_DEFAULT_SINCE_DAYS} days (since=${cronSince.toISOString()}). Pass --since=YYYY-MM-DD to override.`,
    )
  }

  const log = consoleLogger()

  // Dispatcher: `--dry-run` bypasses runOnce / job claim / notify entirely so
  // it never writes a `mail_worker_runs` row. The CLI usage promises "do not
  // write to DB", and runOnce would INSERT a running row before runPipeline
  // even starts. runPipeline(dryRun:true) is pure (parse + classify + count),
  // so this path stays runnable without DATABASE_URL.
  if (flags.dryRun) {
    const summary = await runPipeline({
      since: flags.mockImap ? flags.since : cronSince,
      source,
      dryRun: true,
      logger: log,
      llmExtractor,
    })
    // eslint-disable-next-line no-console
    console.log('pipeline summary:', summary)
    await closeDb()
    return
  }

  // `--no-claim` skips the job queue but still wraps the run in a
  // `mail_worker_runs` row (test/debug for the cron-tick code path).
  // Otherwise, try to claim a pending admin job; if none, fall through.
  if (flags.noClaim) {
    const summary = await runOnce({
      kind: 'cron',
      since: flags.mockImap ? flags.since : cronSince,
      source,
      logger: log,
      llmExtractor,
    })
    // eslint-disable-next-line no-console
    console.log('pipeline summary:', summary)
    await closeDb()
    return
  }

  const db = getDb()

  // Recover any `claimed` rows orphaned by a previous worker crash before we
  // try to claim a new one. Otherwise a dead row keeps blocking the queue
  // from the admin's POV (review r1). Failure here is non-fatal — the
  // dispatcher still gets a chance to claim a fresh `pending` row.
  await recoverStaleClaimedJobs(db).then(
    (recovered) => {
      if (recovered > 0) {
        log.warn('recovered stale claimed mail_worker_jobs rows', { recovered })
      }
    },
    (err) => {
      log.warn('recoverStaleClaimedJobs failed; continuing', {
        err: err instanceof Error ? err.message : String(err),
      })
    },
  )

  const job = await claimNextJob(db).catch((err) => {
    log.warn('claimNextJob failed; falling back to cron tick', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  })

  if (job) {
    log.info('claimed mail_worker_jobs row', {
      jobId: job.id,
      requestedByUserId: job.requestedByUserId,
      since: job.since?.toISOString() ?? null,
    })
    try {
      const summary = await runOnce({
        kind: 'manual',
        triggeredByUserId: job.requestedByUserId,
        since: job.since ?? cronSince,
        source,
        logger: log,
        llmExtractor,
      })
      await markJobDone(db, job.id, summary.runId)
      // eslint-disable-next-line no-console
      console.log('pipeline summary:', summary)
    } catch (err) {
      // runOnce may throw on top-level IMAP failure; the run row is already
      // persisted with status=imap_failed inside runOnce. Mark the job
      // failed so the admin sees the error in the inbox UI.
      const message = err instanceof Error ? err.message : String(err)
      await markJobFailed(db, job.id, message).catch((markErr) => {
        log.warn('markJobFailed also failed', {
          jobId: job.id,
          err: markErr instanceof Error ? markErr.message : String(markErr),
        })
      })
      throw err
    }
  } else {
    const summary = await runOnce({
      kind: 'cron',
      since: cronSince,
      source,
      logger: log,
      llmExtractor,
    })
    // eslint-disable-next-line no-console
    console.log('pipeline summary:', summary)
  }

  await closeDb()
}

/**
 * Build the AI extractor based on CLI flags. `--dry-run` returns `undefined`
 * (the pipeline skips AI entirely). `--mock-llm` loads LLM fixtures from disk
 * via `loadFixturesFromDir`, which keys each payload by the on-file
 * `subject` field so `--mock-imap --mock-llm` smoke runs actually match the
 * real eml subjects (review r1: pre-fix the loader keyed by filename basename
 * and never matched). A missing `test/fixtures/llm/` directory is treated as
 * an empty fixture map so a fresh checkout can run the smoke without seeding
 * fixtures first.
 *
 * The default branch invokes `loadLlmConfig()` which throws unless
 * `ANTHROPIC_API_KEY` is set. We deliberately call this lazily here, AFTER
 * the `--mock-llm` and `--dry-run` early returns, so `--mock-llm` smoke runs
 * never require a real key.
 */
async function buildLlmExtractor(flags: CliFlags): Promise<LLMExtractor | undefined> {
  if (flags.dryRun) return undefined

  if (flags.mockLlm) {
    const llmFixtureDir = join(
      fileURLToPath(new URL('..', import.meta.url)),
      'test',
      'fixtures',
      'llm',
    )
    let fixtures = new Map<string, ExtractionPayload>()
    try {
      const dirStat = await stat(llmFixtureDir)
      if (dirStat.isDirectory()) {
        fixtures = await loadFixturesFromDir(llmFixtureDir)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      // Missing directory → empty fixture map. The default noise response in
      // FixtureLLMExtractor handles every mail without crashing.
    }
    return new FixtureLLMExtractor(fixtures)
  }

  const llmConfig = loadLlmConfig()
  return new AnthropicSonnet46Extractor({ apiKey: llmConfig.anthropicApiKey })
}

/**
 * Console logger gated by `MAIL_WORKER_LOG_LEVEL` (debug | info | warn | error).
 * The PipelineLogger contract only exposes `info` / `warn`, so the level acts
 * as a min-level filter: `warn` silences info logs, `error` silences both,
 * `debug` / `info` (default) emit everything. Operators were able to set this
 * via env before but it was a silent no-op — now it actually applies.
 */
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const

function consoleLogger() {
  const minRank = LEVEL_RANK[loadLogConfig().MAIL_WORKER_LOG_LEVEL]
  const format = (msg: string, ctx?: Record<string, unknown>) =>
    `[mail-worker] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`
  return {
    info: (msg: string, ctx?: Record<string, unknown>) => {
      if (LEVEL_RANK.info < minRank) return
      // eslint-disable-next-line no-console
      console.log(format(msg, ctx))
    },
    warn: (msg: string, ctx?: Record<string, unknown>) => {
      if (LEVEL_RANK.warn < minRank) return
      // eslint-disable-next-line no-console
      console.warn(format(msg, ctx))
    },
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[mail-worker] fatal:', err)
  process.exitCode = 1
})
