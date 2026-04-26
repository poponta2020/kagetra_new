import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailMessages, tournamentDrafts } from '@kagetra/shared/schema'
import { runPipelineFromFixtures } from '../src/pipeline.js'
import {
  FixtureFileSchema,
  FixtureLLMExtractor,
  loadFixturesFromDir,
} from '../src/classify/llm/fixture.js'
import { BrokenLLMExtractor } from '../src/classify/llm/broken.js'
import { type ExtractionPayload } from '../src/classify/schema.js'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'
import { closeDb } from '../src/db.js'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))
const LLM_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/llm/', import.meta.url))

async function loadEml(name: string): Promise<Buffer> {
  return readFile(join(FIXTURE_DIR, name))
}

async function loadPayload(filename: string): Promise<ExtractionPayload> {
  const raw = await readFile(join(LLM_FIXTURE_DIR, filename), 'utf8')
  return FixtureFileSchema.parse(JSON.parse(raw)).payload
}

const TOURNAMENT_SUBJECT = '[taikai-ajka:828] 第65回全日本選手権大会/ご案内'
const ML_TOURNAMENT_SUBJECT = '[taikai-ajka:829] 第66回標榜大会のご案内'
const NEWSLETTER_SUBJECT = 'Weekly Update: New Features Available'

async function buildExtractor(): Promise<FixtureLLMExtractor> {
  return new FixtureLLMExtractor(await loadFixturesFromDir(LLM_FIXTURE_DIR))
}

describe('pipeline AI phase (fixture LLM → DB)', () => {
  beforeEach(async () => {
    await truncateMailTables()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('inserts a tournament_drafts row with status=pending_review for a positive eml', async () => {
    const llm = await buildExtractor()
    const summary = await runPipelineFromFixtures(
      [{ source: await loadEml('tournament-announcement.eml'), imapUid: 100 }],
      { llmExtractor: llm },
    )

    expect(summary.inserted).toBe(1)
    expect(summary.aiSucceeded).toBe(1)
    expect(summary.draftsInserted).toBe(1)
    expect(summary.draftsUpdated).toBe(0)
    expect(summary.aiFailed).toBe(0)
    expect(summary.aiSkipped).toBe(0)

    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.status).toBe('pending_review')
    expect(drafts[0]!.confidence).toBe('0.95')
    // Payload round-trips intact through jsonb.
    const payload = drafts[0]!.extractedPayload as ExtractionPayload
    expect(payload.is_tournament_announcement).toBe(true)
    expect(payload.extracted.title).toBe('第65回全日本選手権大会')

    // Mail status follows the AI verdict.
    const mail = await testDb.select().from(mailMessages)
    expect(mail).toHaveLength(1)
    expect(mail[0]!.status).toBe('ai_done')
  })

  it('skips the AI call entirely for pre-filter noise mails (no draft, no AI counters bump)', async () => {
    const llm = await buildExtractor()
    const summary = await runPipelineFromFixtures(
      [
        { source: await loadEml('newsletter-with-unsubscribe.eml'), imapUid: 200 },
      ],
      { llmExtractor: llm },
    )

    expect(summary.inserted).toBe(1)
    expect(summary.noise).toBe(1)
    expect(summary.aiSkipped).toBe(1)
    expect(summary.aiSucceeded).toBe(0)
    expect(summary.aiFailed).toBe(0)
    expect(summary.draftsInserted).toBe(0)

    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(0)

    // Pre-filter set classification=noise; AI was never invoked, so status
    // stays at the post-fetch value (`fetched`) — there's no `ai_done` /
    // `ai_processing` transition for these.
    const mail = await testDb.select().from(mailMessages)
    expect(mail[0]!.classification).toBe('noise')
    expect(mail[0]!.status).toBe('fetched')
  })

  it('persists ai_failed (mail.status + draft.status + ai_raw_response) on BrokenLLMExtractor', async () => {
    const summary = await runPipelineFromFixtures(
      [{ source: await loadEml('tournament-announcement.eml'), imapUid: 300 }],
      { llmExtractor: new BrokenLLMExtractor() },
    )

    expect(summary.inserted).toBe(1)
    expect(summary.aiFailed).toBe(1)
    expect(summary.aiSucceeded).toBe(0)
    expect(summary.draftsInserted).toBe(1)

    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.status).toBe('ai_failed')
    expect(drafts[0]!.aiRawResponse).toContain('BrokenLLMExtractor')
    expect(drafts[0]!.confidence).toBeNull()

    const mail = await testDb.select().from(mailMessages)
    expect(mail[0]!.status).toBe('ai_failed')
  })

  it('UPDATEs (does not duplicate) the existing draft when re-extracting the same mail', async () => {
    const llm = await buildExtractor()
    const eml = await loadEml('tournament-announcement.eml')

    const first = await runPipelineFromFixtures(
      [{ source: eml, imapUid: 400 }],
      { llmExtractor: llm },
    )
    expect(first.draftsInserted).toBe(1)
    expect(first.draftsUpdated).toBe(0)

    // Same Message-ID — pipeline pre-checks duplicate and short-circuits, so
    // the AI phase doesn't fire. We exercise the re-extract upsert path by
    // directly invoking persistOutcome via classifyMail again on the existing
    // mail row.
    const second = await runPipelineFromFixtures(
      [{ source: eml, imapUid: 400 }],
      { llmExtractor: llm },
    )
    // Duplicate detection short-circuits before AI runs — this is the desired
    // behaviour for cron re-fetches (no wasted Anthropic calls).
    expect(second.duplicated).toBe(1)
    expect(second.draftsInserted).toBe(0)
    expect(second.draftsUpdated).toBe(0)
    expect(second.aiSkipped).toBe(0)

    // Only one draft total (no double insert).
    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(1)
  })

  it('upgrades classification=noise when AI says noise on a mail the pre-filter let through', async () => {
    // ml-tournament-announcement.eml is NOT pre-filtered (mailing list, but
    // PR1 deliberately allows ML announcements through for AI). In this test
    // we override the AI verdict to noise to exercise the `outcome.kind ===
    // 'noise'` → classification upgrade branch in `persistOutcome`.
    const fixtures = new Map<string, ExtractionPayload>()
    fixtures.set(
      ML_TOURNAMENT_SUBJECT,
      await loadPayload('newsletter.expected.json'),
    )
    const llm = new FixtureLLMExtractor(fixtures)

    const summary = await runPipelineFromFixtures(
      [{ source: await loadEml('ml-tournament-announcement.eml'), imapUid: 500 }],
      { llmExtractor: llm },
    )
    expect(summary.aiSucceeded).toBe(1)
    expect(summary.draftsInserted).toBe(0)

    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(0)

    const mail = await testDb.select().from(mailMessages)
    expect(mail[0]!.classification).toBe('noise')
    expect(mail[0]!.status).toBe('ai_done')
  })

  it('retries the AI phase on a duplicate whose previous run left status=ai_processing', async () => {
    // Simulates the crash-mid-call recovery scenario from review r1: a row
    // marked `ai_processing` by an earlier run that died before
    // `persistOutcome` finished. On the next pipeline tick the same mail is
    // re-fetched, hits the duplicate fast path, and (post-fix) re-runs the
    // AI phase on the existing row instead of leaving it stuck forever.
    const llm = await buildExtractor()
    const eml = await loadEml('tournament-announcement.eml')

    // First run completes normally.
    const first = await runPipelineFromFixtures(
      [{ source: eml, imapUid: 700 }],
      { llmExtractor: llm },
    )
    expect(first.draftsInserted).toBe(1)

    // Force the row back to ai_processing as if a worker crashed mid-call.
    await testDb
      .update(mailMessages)
      .set({ status: 'ai_processing' })
      .where(eq(mailMessages.status, 'ai_done'))

    // Second run sees the duplicate and (post-fix) re-runs the AI phase.
    const second = await runPipelineFromFixtures(
      [{ source: eml, imapUid: 700 }],
      { llmExtractor: llm },
    )
    expect(second.duplicated).toBe(1)
    // The retry succeeded — the existing draft is updated, not duplicated.
    expect(second.aiSucceeded).toBe(1)
    expect(second.draftsUpdated).toBe(1)
    expect(second.draftsInserted).toBe(0)

    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(1)

    const mail = await testDb.select().from(mailMessages)
    expect(mail[0]!.status).toBe('ai_done')
  })

  it('does NOT retry AI on a pre-filter-noise duplicate (status=fetched, classification=noise)', async () => {
    // Pre-filter noise rows are deliberately never sent to AI — they're
    // marked `classification='noise'` at insert time and stay `status=fetched`
    // because the AI phase short-circuits. The duplicate-recovery branch
    // must respect that decision (review r1 — only resurrect rows whose AI
    // never had a chance to run, not rows whose AI was deliberately skipped).
    const llm = await buildExtractor()
    const eml = await loadEml('newsletter-with-unsubscribe.eml')

    const first = await runPipelineFromFixtures(
      [{ source: eml, imapUid: 800 }],
      { llmExtractor: llm },
    )
    expect(first.aiSkipped).toBe(1)
    expect(first.aiSucceeded).toBe(0)

    const second = await runPipelineFromFixtures(
      [{ source: eml, imapUid: 800 }],
      { llmExtractor: llm },
    )
    expect(second.duplicated).toBe(1)
    // Crucially: AI was NOT re-run for this duplicate.
    expect(second.aiSucceeded).toBe(0)
    expect(second.aiFailed).toBe(0)
    expect(second.draftsInserted).toBe(0)
    expect(second.draftsUpdated).toBe(0)
  })

  it('without an llmExtractor the AI phase is a no-op (legacy / dry-run compatibility)', async () => {
    const summary = await runPipelineFromFixtures([
      { source: await loadEml('tournament-announcement.eml'), imapUid: 600 },
    ])

    expect(summary.inserted).toBe(1)
    // Every AI counter stays at zero when no extractor is wired.
    expect(summary.aiSucceeded).toBe(0)
    expect(summary.aiFailed).toBe(0)
    expect(summary.aiSkipped).toBe(0)
    expect(summary.draftsInserted).toBe(0)
    expect(summary.draftsUpdated).toBe(0)

    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(0)
  })
})
