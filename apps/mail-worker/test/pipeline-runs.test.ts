import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { mailWorkerRuns } from '@kagetra/shared/schema'
import {
  closeTestDb,
  testDb,
  truncateMailTables,
  truncateMailWorkerTables,
} from './test-db.js'
import { runOnce, runPipeline } from '../src/pipeline.js'
import { FixtureMailSource, type MailSource } from '../src/fetch/fetcher.js'
import type { FetchSinceResult } from '../src/fetch/imap-client.js'
import {
  FixtureLLMExtractor,
  loadFixturesFromDir,
} from '../src/classify/llm/fixture.js'
import { BrokenLLMExtractor } from '../src/classify/llm/broken.js'
import type { LLMExtractor } from '../src/classify/llm/types.js'
import { closeDb } from '../src/db.js'
import type { MailWorkerRunSummary } from '../src/notify/orchestrator.js'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))
const LLM_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/llm/', import.meta.url))

async function loadEml(name: string): Promise<Buffer> {
  return readFile(join(FIXTURE_DIR, name))
}

async function buildExtractor(): Promise<FixtureLLMExtractor> {
  return new FixtureLLMExtractor(await loadFixturesFromDir(LLM_FIXTURE_DIR))
}

async function buildSource(emlNames: string[]): Promise<FixtureMailSource> {
  const fixtures = await Promise.all(
    emlNames.map(async (n) => ({ source: await loadEml(n) })),
  )
  return new FixtureMailSource(fixtures)
}

class ThrowingMailSource implements MailSource {
  constructor(private readonly message: string) {}
  async fetch(_since: Date | undefined): Promise<FetchSinceResult> {
    throw new Error(this.message)
  }
  async close(): Promise<void> {
    return undefined
  }
}

/**
 * Seed N synthetic prior runs into `mail_worker_runs` ordered by startedAt
 * descending (newest first). Each run gets a distinct `started_at` so the
 * `desc(startedAt)` ordering in `fetchRecentRuns` is deterministic.
 *
 * Returns the inserted ids in the same order as `seeds`.
 */
async function seedPriorRuns(
  seeds: Array<{
    summary: MailWorkerRunSummary
    status: 'success' | 'imap_failed' | 'ai_failed' | 'partial'
    startedAtOffsetMs: number // negative = older
  }>,
): Promise<number[]> {
  const baseTime = Date.now()
  const ids: number[] = []
  for (const seed of seeds) {
    const startedAt = new Date(baseTime + seed.startedAtOffsetMs)
    const inserted = await testDb
      .insert(mailWorkerRuns)
      .values({
        startedAt,
        finishedAt: startedAt,
        kind: 'cron',
        status: seed.status,
        summary: seed.summary,
        error: null,
      })
      .returning({ id: mailWorkerRuns.id })
    ids.push(inserted[0]!.id)
  }
  return ids
}

async function fetchRunById(id: number) {
  const rows = await testDb
    .select()
    .from(mailWorkerRuns)
    .where(eq(mailWorkerRuns.id, id))
  return rows[0]!
}

async function latestRun() {
  const rows = await testDb
    .select()
    .from(mailWorkerRuns)
    .orderBy(desc(mailWorkerRuns.startedAt))
    .limit(1)
  return rows[0]!
}

describe('runOnce → mail_worker_runs persistence', () => {
  beforeEach(async () => {
    await truncateMailTables()
    await truncateMailWorkerTables()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('runPipeline(dryRun=true) does NOT insert a mail_worker_runs row (regression: --dry-run was writing a run row)', async () => {
    // Pre-fix: index.ts routed --dry-run through runOnce(), which always
    // INSERTs a mail_worker_runs row before delegating. The CLI usage
    // promised "do not write to DB", so dry-run is now wired to runPipeline
    // directly. This test pins the contract on the layer the dispatcher
    // calls — runPipeline must not touch mail_worker_runs.
    const llm = await buildExtractor()
    const source = await buildSource(['tournament-announcement.eml'])

    const before = await testDb.select().from(mailWorkerRuns)
    expect(before).toHaveLength(0)

    const summary = await runPipeline({
      source,
      dryRun: true,
      llmExtractor: llm,
    })

    // Dry-run still surfaces fetch counters but skips DB writes.
    expect(summary.fetched).toBe(1)
    expect(summary.inserted).toBe(0)

    const after = await testDb.select().from(mailWorkerRuns)
    expect(after).toHaveLength(0)
  })

  it('happy path: inserts running row and updates to success with summary counters', async () => {
    const llm = await buildExtractor()
    const source = await buildSource(['tournament-announcement.eml'])
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    const result = await runOnce({
      kind: 'cron',
      source,
      llmExtractor: llm,
      notifier,
    })

    expect(result.runId).toBeGreaterThan(0)
    expect(result.fetched).toBe(1)
    expect(result.draftsInserted).toBe(1)

    const row = await fetchRunById(result.runId)
    expect(row.status).toBe('success')
    expect(row.kind).toBe('cron')
    expect(row.finishedAt).not.toBeNull()
    expect(row.error).toBeNull()
    expect(row.triggeredByUserId).toBeNull()

    const summary = row.summary as MailWorkerRunSummary
    expect(summary.fetched).toBe(1)
    expect(summary.classified).toBe(1)
    expect(summary.drafts_created).toBe(1)
    expect(summary.ai_failed).toBe(0)
    expect(summary.imap_error).toBe(false)
    expect(summary.errors).toEqual([])
    expect(summary.new_draft_subjects).toContain(
      '[taikai-ajka:828] 第65回全日本選手権大会/ご案内',
    )

    // Notifier was called once for new drafts (no consecutive failure trigger).
    expect(notifier).toHaveBeenCalledTimes(1)
  })

  it('IMAP throw → status=imap_failed and error/summary recorded; rethrows', async () => {
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    await expect(
      runOnce({
        kind: 'cron',
        source: new ThrowingMailSource('IMAP connect refused'),
        notifier,
      }),
    ).rejects.toThrow(/IMAP connect refused/)

    const row = await latestRun()
    expect(row.status).toBe('imap_failed')
    expect(row.error).toBe('IMAP connect refused')
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.imap_error).toBe(true)
    expect(summary.errors).toEqual(['IMAP connect refused'])
    expect(summary.fetched).toBe(0)
  })

  it('AI partial: some succeed, some fail → status=partial', async () => {
    // Two mails: one positive that uses the fixture extractor (succeeds),
    // and one ml-tournament that the broken extractor throws on. We compose
    // a custom extractor here.
    const llmFixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)
    const fixtureLlm = new FixtureLLMExtractor(llmFixtures)
    const broken = new BrokenLLMExtractor()
    const composite: LLMExtractor = {
      modelId: 'composite-test',
      async extract(input) {
        if (input.emailMeta.subject.includes('第65回')) {
          return fixtureLlm.extract(input)
        }
        return broken.extract(input)
      },
    }
    const source = await buildSource([
      'tournament-announcement.eml',
      'ml-tournament-announcement.eml',
    ])
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    const result = await runOnce({
      kind: 'cron',
      source,
      llmExtractor: composite,
      notifier,
    })

    expect(result.aiSucceeded).toBe(1)
    expect(result.aiFailed).toBe(1)
    const row = await fetchRunById(result.runId)
    expect(row.status).toBe('partial')
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.ai_failed).toBe(1)
    expect(summary.classified).toBe(2)
  })

  it('AI-only failure with no AI successes → status=ai_failed', async () => {
    const source = await buildSource(['tournament-announcement.eml'])
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    const result = await runOnce({
      kind: 'cron',
      source,
      llmExtractor: new BrokenLLMExtractor(),
      notifier,
    })

    expect(result.aiFailed).toBe(1)
    expect(result.aiSucceeded).toBe(0)
    const row = await fetchRunById(result.runId)
    expect(row.status).toBe('ai_failed')
  })

  it('triggers IMAP consecutive-failure notification on the 3rd run and marks notified_imap_alert', async () => {
    // Seed two prior IMAP-failed runs (NEITHER notified). Newest seed is at
    // -1ms; the third-to-newest is at -1000ms — the current run will land at
    // ~now() and become the most recent automatically.
    await seedPriorRuns([
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['IMAP fail #1'],
        },
        startedAtOffsetMs: -2000,
      },
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['IMAP fail #2'],
        },
        startedAtOffsetMs: -1000,
      },
    ])

    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    await expect(
      runOnce({
        kind: 'cron',
        source: new ThrowingMailSource('IMAP fail #3'),
        notifier,
      }),
    ).rejects.toThrow(/IMAP fail #3/)

    expect(notifier).toHaveBeenCalledTimes(1)
    const messageArg = notifier.mock.calls[0]![1] as string
    expect(messageArg).toMatch(/連続/)
    expect(messageArg).toMatch(/IMAP fail #3/)

    const row = await latestRun()
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.notified_imap_alert).toBe(true)
  })

  it('does NOT re-notify when the previous run already has notified_imap_alert=true', async () => {
    await seedPriorRuns([
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['IMAP fail #1'],
        },
        startedAtOffsetMs: -3000,
      },
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['IMAP fail #2'],
        },
        startedAtOffsetMs: -2000,
      },
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['IMAP fail #3'],
          notified_imap_alert: true,
        },
        startedAtOffsetMs: -1000,
      },
    ])

    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )
    await expect(
      runOnce({
        kind: 'cron',
        source: new ThrowingMailSource('IMAP fail #4'),
        notifier,
      }),
    ).rejects.toThrow(/IMAP fail #4/)

    expect(notifier).not.toHaveBeenCalled()
    const row = await latestRun()
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.notified_imap_alert).toBeUndefined()
  })

  it('resets after recovery: success after notified, then 3 more failures re-notify', async () => {
    // Seed: fail (notified) → success → fail × 2 → run a third failing run.
    await seedPriorRuns([
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['old fail'],
          notified_imap_alert: true,
        },
        startedAtOffsetMs: -5000,
      },
      {
        status: 'success',
        summary: {
          fetched: 1,
          classified: 1,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: false,
          errors: [],
        },
        startedAtOffsetMs: -4000,
      },
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['fail #1'],
        },
        startedAtOffsetMs: -2000,
      },
      {
        status: 'imap_failed',
        summary: {
          fetched: 0,
          classified: 0,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: true,
          errors: ['fail #2'],
        },
        startedAtOffsetMs: -1000,
      },
    ])

    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )
    await expect(
      runOnce({
        kind: 'cron',
        source: new ThrowingMailSource('fail #3'),
        notifier,
      }),
    ).rejects.toThrow(/fail #3/)

    expect(notifier).toHaveBeenCalledTimes(1)
    const row = await latestRun()
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.notified_imap_alert).toBe(true)
  })

  it('new-drafts notification fires when drafts_created > 0', async () => {
    const llm = await buildExtractor()
    const source = await buildSource(['tournament-announcement.eml'])
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    await runOnce({
      kind: 'cron',
      source,
      llmExtractor: llm,
      notifier,
    })
    expect(notifier).toHaveBeenCalledTimes(1)
    const message = notifier.mock.calls[0]![1] as string
    expect(message).toMatch(/新規大会案内 1 件/)
    expect(message).toMatch(/第65回/)
  })

  it('does NOT push when drafts_created is 0 (and no consecutive failure)', async () => {
    const llm = await buildExtractor()
    const source = await buildSource(['newsletter-with-unsubscribe.eml'])
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )

    await runOnce({
      kind: 'cron',
      source,
      llmExtractor: llm,
      notifier,
    })
    expect(notifier).not.toHaveBeenCalled()
  })

  it('AI consecutive-failure: [0, 0, 3] does NOT trigger (only one run actually failed)', async () => {
    // Pre-fix the orchestrator triggered on cumulative >= 3 alone, so a
    // single bad batch of 3 looked the same as three consecutive failed runs.
    // Now every recent run must have ai_failed > 0.
    await seedPriorRuns([
      {
        status: 'success',
        summary: {
          fetched: 1,
          classified: 1,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: false,
          errors: [],
        },
        startedAtOffsetMs: -2000,
      },
      {
        status: 'success',
        summary: {
          fetched: 1,
          classified: 1,
          drafts_created: 0,
          ai_failed: 0,
          imap_error: false,
          errors: [],
        },
        startedAtOffsetMs: -1000,
      },
    ])

    // Current run: a single mail that AI fails on three retries (broken
    // extractor → ai_failed=1 in our pipeline summary, not 3 — the broken
    // extractor crashes the AI phase once per mail). To approximate the
    // [0, 0, 3] scenario we directly invoke evaluateAndNotify against a
    // current run with summary.ai_failed=3.
    const currentInserted = await testDb
      .insert(mailWorkerRuns)
      .values({
        startedAt: new Date(),
        finishedAt: new Date(),
        kind: 'cron',
        status: 'ai_failed',
        summary: {
          fetched: 3,
          classified: 3,
          drafts_created: 0,
          ai_failed: 3,
          imap_error: false,
          errors: ['Anthropic 500'],
        } satisfies MailWorkerRunSummary,
        error: null,
      })
      .returning({ id: mailWorkerRuns.id })
    const currentRunId = currentInserted[0]!.id

    const { evaluateAndNotify } = await import('../src/notify/orchestrator.js')
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )
    await evaluateAndNotify(
      (await import('../src/db.js')).getDb(),
      currentRunId,
      undefined,
      notifier,
    )
    expect(notifier).not.toHaveBeenCalled()
    const row = await fetchRunById(currentRunId)
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.notified_ai_alert).toBeUndefined()
  })

  it('AI consecutive-failure: [1, 1, 1] DOES trigger (three runs in a row each failed once)', async () => {
    await seedPriorRuns([
      {
        status: 'ai_failed',
        summary: {
          fetched: 1,
          classified: 1,
          drafts_created: 0,
          ai_failed: 1,
          imap_error: false,
          errors: ['fail #1'],
        },
        startedAtOffsetMs: -2000,
      },
      {
        status: 'ai_failed',
        summary: {
          fetched: 1,
          classified: 1,
          drafts_created: 0,
          ai_failed: 1,
          imap_error: false,
          errors: ['fail #2'],
        },
        startedAtOffsetMs: -1000,
      },
    ])

    const currentInserted = await testDb
      .insert(mailWorkerRuns)
      .values({
        startedAt: new Date(),
        finishedAt: new Date(),
        kind: 'cron',
        status: 'ai_failed',
        summary: {
          fetched: 1,
          classified: 1,
          drafts_created: 0,
          ai_failed: 1,
          imap_error: false,
          errors: ['fail #3'],
        } satisfies MailWorkerRunSummary,
        error: null,
      })
      .returning({ id: mailWorkerRuns.id })
    const currentRunId = currentInserted[0]!.id

    const { evaluateAndNotify } = await import('../src/notify/orchestrator.js')
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    )
    await evaluateAndNotify(
      (await import('../src/db.js')).getDb(),
      currentRunId,
      undefined,
      notifier,
    )
    expect(notifier).toHaveBeenCalledTimes(1)
    const messageArg = notifier.mock.calls[0]![1] as string
    expect(messageArg).toMatch(/AI 抽出/)
    const row = await fetchRunById(currentRunId)
    const summary = row.summary as MailWorkerRunSummary
    expect(summary.notified_ai_alert).toBe(true)
  })

  it('catches notifier throws (LineNotifyError-style) without aborting the run', async () => {
    const llm = await buildExtractor()
    const source = await buildSource(['tournament-announcement.eml'])
    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => {
        throw new Error('LINE 401 unauthorized')
      },
    )

    const result = await runOnce({
      kind: 'cron',
      source,
      llmExtractor: llm,
      notifier,
    })

    // Run still finalised cleanly.
    expect(result.runId).toBeGreaterThan(0)
    const row = await fetchRunById(result.runId)
    expect(row.status).toBe('success')
    // Notifier was invoked (and threw); run row is intact.
    expect(notifier).toHaveBeenCalledTimes(1)
  })
})
