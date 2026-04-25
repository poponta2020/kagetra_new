import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from './pipeline.js'
import { FixtureMailSource } from './fetch/fetcher.js'
import { closeDb } from './db.js'
import { loadConfig } from './config.js'
import { parseSinceArg } from './cli-args.js'

interface CliFlags {
  /**
   * Currently a no-op — the worker always exits after one run. Parsed for
   * forward-compat with the `--watch` flag landing in PR5; keeps existing cron
   * invocations working unchanged once `--watch` ships.
   */
  once: boolean
  since: Date | undefined
  mockImap: boolean
  dryRun: boolean
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
    dryRun: false,
    fixtureDir: undefined,
  }
  for (const arg of argv) {
    if (arg === '--once') flags.once = true
    else if (arg === '--mock-imap') flags.mockImap = true
    else if (arg === '--dry-run') flags.dryRun = true
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
                         Pass an ISO datetime with offset (e.g. 2026-04-12T15:00:00+09:00)
                         to use a sub-day cutoff. Live IMAP defaults to the last
                         ${LIVE_DEFAULT_SINCE_DAYS} days when omitted.
  --mock-imap            Use fixture eml files instead of live IMAP.
  --fixture-dir=PATH     Directory of *.eml files for --mock-imap (default: ./test/fixtures).
  --dry-run              Parse only; do not write to DB.
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

  if (flags.mockImap) {
    const dir = flags.fixtureDir
      ?? join(fileURLToPath(new URL('..', import.meta.url)), 'test', 'fixtures')
    const fixtures = await loadFixtureBuffers(dir)
    const source = new FixtureMailSource(fixtures)
    const summary = await runPipeline({
      since: flags.since,
      source,
      dryRun: flags.dryRun,
      logger: consoleLogger(),
    })
    // eslint-disable-next-line no-console
    console.log('pipeline summary:', summary)
  } else {
    // Live IMAP without --since used to scan the full INBOX (`{ all: true }`)
    // and pull every body/attachment into memory. Default to the last
    // LIVE_DEFAULT_SINCE_DAYS so a stray `pnpm start` can't blow up the worker.
    const effectiveSince = flags.since ?? defaultLiveSince()
    if (!flags.since) {
      // eslint-disable-next-line no-console
      console.log(
        `[mail-worker] --since not provided; defaulting to last ${LIVE_DEFAULT_SINCE_DAYS} days (since=${effectiveSince.toISOString()}). Pass --since=YYYY-MM-DD to override.`,
      )
    }
    const summary = await runPipeline({
      since: effectiveSince,
      dryRun: flags.dryRun,
      logger: consoleLogger(),
    })
    // eslint-disable-next-line no-console
    console.log('pipeline summary:', summary)
  }

  await closeDb()
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
  const minRank = LEVEL_RANK[loadConfig().MAIL_WORKER_LOG_LEVEL]
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
