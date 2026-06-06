import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runManualExtract, runOnce, RunOnceError, runPipeline } from './pipeline.js'
import { FixtureMailSource } from './fetch/fetcher.js'
import { closeDb, getDb } from './db.js'
import { loadLogConfig, loadLlmConfig, loadWebPushConfig } from './config.js'
import { parseSinceArg } from './cli-args.js'
import {
  claimNextJob,
  markJobDone,
  markJobFailed,
  parseManualExtractPayload,
  recoverStaleClaimedJobs,
  STALE_CLAIM_RECOVERY_MS_EXTRACT,
} from './jobs.js'
import { FixtureLLMExtractor, loadFixturesFromDir } from './classify/llm/fixture.js'
import { AnthropicSonnet46Extractor } from './classify/llm/anthropic.js'
import type { LLMExtractor } from './classify/llm/types.js'
import type { ExtractionPayload } from './classify/schema.js'

/**
 * mail-inbox-mailer: dispatcher の動作 mode。
 * - 'fetch': 既存 cron。IMAP fetch + persist のみ実行。**AI 抽出は呼ばない**。
 *            `fetch` ジョブの claim も受ける（既存の手動 fetch 操作）。
 * - 'extract': mail-inbox-mailer タスク2 の新規モード。IMAP fetch をスキップ
 *              して `manual_extract` ジョブのみ pick → `runManualExtract`。
 *              30 秒間隔の systemd timer から起動される想定。
 */
type DispatcherMode = 'fetch' | 'extract'

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
  /** mail-inbox-mailer: dispatcher mode (default: 'fetch'). */
  mode: DispatcherMode
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
    mode: 'fetch',
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
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length)
      if (value === 'extract-only') flags.mode = 'extract'
      else if (value === 'fetch-only' || value === 'fetch') flags.mode = 'fetch'
      else throw new Error(`unknown --mode value: ${value} (expected fetch-only or extract-only)`)
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
  --mode=fetch-only      (default) IMAP fetch + 'fetch' job dispatch. AI extraction
                         is NOT invoked (mail-inbox-mailer: cron AI 廃止)。
  --mode=extract-only    Skip IMAP fetch entirely; only claim 'manual_extract'
                         jobs and run runManualExtract on each.
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

  // mail-inbox-mailer: AI 抽出は extract-only mode のみで使う。fetch mode は
  // cron AI 廃止により llmExtractor を渡さない運用に変更（cron が
  // ANTHROPIC_API_KEY なしで動くようになる）。
  //
  // build branches:
  //   --dry-run                 → undefined (AI phase skipped entirely)
  //   --mode=fetch-only (def)   → undefined (cron AI 廃止)
  //   --mode=extract-only       → FixtureLLMExtractor or AnthropicSonnet46Extractor
  const llmExtractor =
    flags.mode === 'extract' ? await buildLlmExtractor(flags) : undefined

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
  if (!flags.since && !flags.mockImap && flags.mode === 'fetch') {

    console.log(
      `[mail-worker] --since not provided; defaulting to last ${LIVE_DEFAULT_SINCE_DAYS} days (since=${cronSince.toISOString()}). Pass --since=YYYY-MM-DD to override.`,
    )
  }

  const log = consoleLogger()
  // mail-triage-badge: VAPID 設定（3つ揃わなければ null = Push 配信無効）。
  // dry-run は DB も配信もしないので runPipeline 直叩きパスでは使わない。
  const webPushConfig = loadWebPushConfig()

  // The whole dispatcher runs inside try/finally so the pg pool is always
  // closed — including on top-level throw. Pre-fix, IMAP failures in
  // runOnce() rethrew past the bottom-of-main `closeDb()`, leaving the pool
  // open until systemd's TimeoutStartSec killed the unit (review r2 blocker).
  // closeDb() is idempotent and a no-op when no pool was opened, so the
  // dry-run / parseArgs-throw paths are safe.
  try {
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

      console.log('pipeline summary:', summary)
      return
    }

    // mail-inbox-mailer: extract-only mode は IMAP fetch せず、manual_extract
    // ジョブだけを 1 件 pick して runManualExtract を回す。
    if (flags.mode === 'extract') {
      await runExtractOnlyDispatcher({
        llmExtractor: llmExtractor!,
        webPushConfig,
        log,
      })
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
        webPushConfig,
      })

      console.log('pipeline summary:', summary)
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

    // mail-inbox-mailer: fetch mode は 'fetch' ジョブだけ拾う。
    // 'manual_extract' は 30 秒間隔の extract-only timer に任せる。
    const job = await claimNextJob(db, { kinds: ['fetch'] }).catch((err) => {
      log.warn('claimNextJob failed; falling back to cron tick', {
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    })

    if (job) {
      log.info('claimed mail_worker_jobs row', {
        jobId: job.id,
        kind: job.kind,
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
          webPushConfig,
        })
        await markJobDone(db, job.id, summary.runId)

        console.log('pipeline summary:', summary)
      } catch (err) {
        // runOnce may throw on top-level IMAP failure; the run row is already
        // persisted with status=imap_failed inside runOnce. Mark the job
        // failed so the admin sees the error in the inbox UI. When runOnce
        // throws RunOnceError we forward its `runId` so the failed job links
        // back to the run that captured the error detail (review r2).
        const message = err instanceof Error ? err.message : String(err)
        const failedRunId = err instanceof RunOnceError ? err.runId : null
        await markJobFailed(db, job.id, message, failedRunId).catch((markErr) => {
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
        webPushConfig,
      })

      console.log('pipeline summary:', summary)
    }
  } finally {
    await closeDb()
  }
}

/**
 * mail-inbox-mailer タスク2: extract-only dispatcher。
 *
 * 30 秒間隔の systemd timer から呼ばれる想定。1 tick で manual_extract ジョブを
 * 1 件だけ pick して runManualExtract を回す（次の tick で次の 1 件、という
 * sequential 動作）。pick できなければ no-op で抜ける。
 *
 * IMAP fetch を一切呼ばないので、ANTHROPIC_API_KEY だけあれば動く。
 */
async function runExtractOnlyDispatcher(opts: {
  llmExtractor: LLMExtractor
  webPushConfig: ReturnType<typeof loadWebPushConfig>
  log: ReturnType<typeof consoleLogger>
}): Promise<void> {
  const db = getDb()

  // mail-inbox-mailer (Codex r8 should-fix): manual_extract は systemd 側で
  // TimeoutStartSec=300 (5 分) で kill されるので、fetch と同じ 1 時間閾値だと
  // LLM/API ハングで kill されたジョブが ai_processing のまま最大 1 時間
  // 残ってしまい polling 画面が進まない。manual_extract だけ 10 分閾値で
  // 専用復旧し、他 kind (fetch) は fetch dispatcher 側に任せる。
  await recoverStaleClaimedJobs(db, {
    staleAfterMs: STALE_CLAIM_RECOVERY_MS_EXTRACT,
    kinds: ['manual_extract'],
  }).then(
    (recovered) => {
      if (recovered > 0) {
        opts.log.warn('recovered stale claimed manual_extract jobs', { recovered })
      }
    },
    (err) => {
      opts.log.warn('recoverStaleClaimedJobs failed; continuing', {
        err: err instanceof Error ? err.message : String(err),
      })
    },
  )

  const job = await claimNextJob(db, { kinds: ['manual_extract'] }).catch((err) => {
    opts.log.warn('claimNextJob (extract-only) failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  })

  if (!job) {
    opts.log.info('extract-only: no pending manual_extract jobs')
    return
  }

  opts.log.info('claimed manual_extract job', {
    jobId: job.id,
    requestedByUserId: job.requestedByUserId,
  })

  try {
    const { mail_message_id: mailMessageId } = parseManualExtractPayload(job.payload)
    const result = await runManualExtract({
      mailMessageId,
      llmExtractor: opts.llmExtractor,
      triggeredByUserId: job.requestedByUserId,
      webPushConfig: opts.webPushConfig,
      logger: opts.log,
    })
    await markJobDone(db, job.id, result.runId)

    console.log('manual_extract result:', result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markJobFailed(db, job.id, message, null).catch((markErr) => {
      opts.log.warn('markJobFailed (manual_extract) also failed', {
        jobId: job.id,
        err: markErr instanceof Error ? markErr.message : String(markErr),
      })
    })
    throw err
  }
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

      console.log(format(msg, ctx))
    },
    warn: (msg: string, ctx?: Record<string, unknown>) => {
      if (LEVEL_RANK.warn < minRank) return

      console.warn(format(msg, ctx))
    },
  }
}

main().catch((err) => {

  console.error('[mail-worker] fatal:', err)
  process.exitCode = 1
})
