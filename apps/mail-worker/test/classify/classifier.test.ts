import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailMessages, tournamentDrafts } from '@kagetra/shared/schema'
import {
  classifyMail,
  persistOutcome,
  type ClassifyOutcome,
} from '../../src/classify/classifier.js'
import { type ExtractionPayload } from '../../src/classify/schema.js'
import {
  FixtureFileSchema,
  FixtureLLMExtractor,
  loadFixturesFromDir,
} from '../../src/classify/llm/fixture.js'
import { BrokenLLMExtractor } from '../../src/classify/llm/broken.js'
import type { LLMExtractionResult } from '../../src/classify/llm/types.js'
import { closeTestDb, testDb, truncateMailTables } from '../test-db.js'
import { closeDb, getDb } from '../../src/db.js'

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/', import.meta.url))

// Subjects must match the on-disk fixture wrappers in test/fixtures/llm/.
// `loadFixturesFromDir` is the source of truth at runtime — these constants
// are the convenience handles tests use to insert the right `mail_messages`
// row before invoking the classifier.
const TOURNAMENT_SUBJECT = '[taikai-ajka:828] 第65回全日本選手権大会/ご案内'
const ML_TOURNAMENT_SUBJECT = '[taikai-ajka:829] 第66回標榜大会のご案内'
const NEWSLETTER_SUBJECT = 'Weekly Update: New Features Available'
const CORRECTION_SUBJECT = 'Re: 【訂正】第65回全日本選手権大会のご案内'

async function loadPayload(filename: string): Promise<ExtractionPayload> {
  const raw = await readFile(join(FIXTURES_DIR, filename), 'utf8')
  return FixtureFileSchema.parse(JSON.parse(raw)).payload
}

async function buildFixtureMap(): Promise<Map<string, ExtractionPayload>> {
  return loadFixturesFromDir(FIXTURES_DIR)
}

interface InsertMailOpts {
  subject: string | null
  messageId: string
  classification?: 'tournament' | 'noise' | 'unknown' | null
  bodyText?: string
}

async function insertTestMail(opts: InsertMailOpts): Promise<number> {
  const inserted = await testDb
    .insert(mailMessages)
    .values({
      messageId: opts.messageId,
      fromAddress: 'test@example.com',
      fromName: null,
      toAddresses: ['org@example.com'],
      subject: opts.subject,
      receivedAt: new Date('2026-04-15T09:00:00+09:00'),
      bodyText: opts.bodyText ?? 'test body',
      bodyHtml: null,
      classification: opts.classification ?? null,
      status: 'fetched',
      imapUid: null,
      imapBox: null,
    })
    .returning({ id: mailMessages.id })
  return inserted[0]!.id
}

describe('classifier', () => {
  beforeEach(async () => {
    await truncateMailTables()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  describe('classifyMail', () => {
    it('returns a tournament outcome when the LLM positively identifies a mail', async () => {
      const fixtures = await buildFixtureMap()
      const llm = new FixtureLLMExtractor(fixtures)
      const id = await insertTestMail({
        messageId: '<positive-1@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, llm)

      expect(outcome.kind).toBe('tournament')
      if (outcome.kind === 'tournament') {
        expect(outcome.result.parsed.is_tournament_announcement).toBe(true)
        expect(outcome.result.parsed.extracted.title).toBe('第65回全日本選手権大会')
      }
    })

    it('returns a noise outcome when the LLM says is_tournament_announcement=false', async () => {
      const fixtures = await buildFixtureMap()
      const llm = new FixtureLLMExtractor(fixtures)
      const id = await insertTestMail({
        messageId: '<negative-1@example.com>',
        subject: NEWSLETTER_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, llm)

      expect(outcome.kind).toBe('noise')
      if (outcome.kind === 'noise') {
        expect(outcome.result.parsed.is_tournament_announcement).toBe(false)
      }
    })

    it('short-circuits to skipped_noise when pre-filter set classification=noise (force=false)', async () => {
      let calls = 0
      const llm = new FixtureLLMExtractor(new Map())
      const wrapped = {
        async extract(input: Parameters<typeof llm.extract>[0]) {
          calls += 1
          return llm.extract(input)
        },
      }
      const id = await insertTestMail({
        messageId: '<noise-1@example.com>',
        subject: NEWSLETTER_SUBJECT,
        classification: 'noise',
      })

      const outcome = await classifyMail(getDb(), id, wrapped)

      expect(outcome.kind).toBe('skipped_noise')
      // Most importantly: the LLM was never invoked.
      expect(calls).toBe(0)
    })

    it('invokes the LLM even on noise-marked mails when force=true', async () => {
      const fixtures = await buildFixtureMap()
      const llm = new FixtureLLMExtractor(fixtures)
      const id = await insertTestMail({
        messageId: '<forced-1@example.com>',
        subject: TOURNAMENT_SUBJECT,
        classification: 'noise',
      })

      const outcome = await classifyMail(getDb(), id, llm, { force: true })

      expect(outcome.kind).toBe('tournament')
    })

    it('flags is_correction=true on a correction-style mail', async () => {
      const fixtures = await buildFixtureMap()
      const llm = new FixtureLLMExtractor(fixtures)
      const id = await insertTestMail({
        messageId: '<correction-1@example.com>',
        subject: CORRECTION_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, llm)

      expect(outcome.kind).toBe('tournament')
      if (outcome.kind === 'tournament') {
        expect(outcome.result.parsed.is_correction).toBe(true)
        expect(outcome.result.parsed.references_subject).toBe(
          '第65回全日本選手権大会のご案内',
        )
      }
    })

    it('returns a failed outcome with the raw error after BrokenLLMExtractor throws twice', async () => {
      const llm = new BrokenLLMExtractor()
      const id = await insertTestMail({
        messageId: '<broken-1@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, llm)

      expect(outcome.kind).toBe('failed')
      if (outcome.kind === 'failed') {
        expect(outcome.rawResponse).toContain('BrokenLLMExtractor')
        expect(outcome.reason).toContain('failed twice')
      }
    })

    it('throws when the message id does not exist (caller bug, not row-level state)', async () => {
      const llm = new FixtureLLMExtractor(new Map())
      await expect(classifyMail(getDb(), 9_999_999, llm)).rejects.toThrow(
        /not found/,
      )
    })
  })

  describe('persistOutcome', () => {
    function buildResultFromPayload(parsed: ExtractionPayload): LLMExtractionResult {
      return {
        parsed,
        raw: JSON.stringify(parsed),
        tokensInput: 100,
        tokensOutput: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
        model: 'fixture',
        promptVersion: 'fixture-1.0',
      }
    }

    it('inserts a draft row on first persist for a tournament outcome', async () => {
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<persist-insert@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })
      const outcome: ClassifyOutcome = {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      }

      const tally = await persistOutcome(getDb(), id, outcome)

      expect(tally.draftsInserted).toBe(1)
      expect(tally.draftsUpdated).toBe(0)
      expect(tally.aiSucceeded).toBe(1)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(1)
      expect(drafts[0]!.status).toBe('pending_review')
      expect(drafts[0]!.confidence).toBe('0.95')
      expect(drafts[0]!.aiModel).toBe('fixture')

      // Mail status follows the draft, AND classification is upgraded to
      // 'tournament' so the inbox pill matches the verdict (review r1 fix —
      // pre-fix only the noise branch updated classification).
      const mail = await testDb
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
      expect(mail[0]!.status).toBe('ai_done')
      expect(mail[0]!.classification).toBe('tournament')
    })

    it('updates the same draft on a second persist (UNIQUE message_id)', async () => {
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<persist-update@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })
      const outcome: ClassifyOutcome = {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      }

      const first = await persistOutcome(getDb(), id, outcome)
      expect(first.draftsInserted).toBe(1)
      const second = await persistOutcome(getDb(), id, outcome)
      expect(second.draftsUpdated).toBe(1)
      expect(second.draftsInserted).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(1)
    })

    it('upgrades classification=noise on the parent mail when the AI verdict is noise', async () => {
      const payload = await loadPayload('newsletter.expected.json')
      const id = await insertTestMail({
        messageId: '<persist-noise@example.com>',
        subject: NEWSLETTER_SUBJECT,
      })
      const outcome: ClassifyOutcome = {
        kind: 'noise',
        result: buildResultFromPayload(payload),
      }

      const tally = await persistOutcome(getDb(), id, outcome)

      expect(tally.aiSucceeded).toBe(1)
      // No draft is inserted for noise — drafts only exist for positive mails.
      expect(tally.draftsInserted).toBe(0)
      expect(tally.draftsUpdated).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(0)

      const mail = await testDb
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
      expect(mail[0]!.classification).toBe('noise')
      expect(mail[0]!.status).toBe('ai_done')
    })

    it('writes an ai_failed draft (status + raw response) when the outcome is failed', async () => {
      const id = await insertTestMail({
        messageId: '<persist-failed@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })
      const outcome: ClassifyOutcome = {
        kind: 'failed',
        rawResponse: 'Error: BrokenLLMExtractor: forced failure',
        reason: 'LLM call or Zod validation failed twice',
      }

      const tally = await persistOutcome(getDb(), id, outcome)

      expect(tally.draftsInserted).toBe(1)
      expect(tally.aiFailed).toBe(1)
      expect(tally.aiSucceeded).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(1)
      expect(drafts[0]!.status).toBe('ai_failed')
      expect(drafts[0]!.aiRawResponse).toContain('BrokenLLMExtractor')
      expect(drafts[0]!.confidence).toBeNull()

      const mail = await testDb
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
      expect(mail[0]!.status).toBe('ai_failed')
    })

    it('marks an existing pending_review draft superseded when re-extract flips to noise', async () => {
      const tournamentPayload = await loadPayload(
        'tournament-announcement.expected.json',
      )
      const noisePayload = await loadPayload('newsletter.expected.json')
      const id = await insertTestMail({
        messageId: '<noise-supersedes@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      // First run: AI says tournament — draft is pending_review.
      await persistOutcome(getDb(), id, {
        kind: 'tournament',
        result: buildResultFromPayload(tournamentPayload),
      })
      const before = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(before).toHaveLength(1)
      expect(before[0]!.status).toBe('pending_review')

      // Re-extract: AI now says noise. The pending draft must transition to
      // `superseded` so the review queue stops surfacing a verdict the model
      // already retracted (review r1 Should Fix).
      const tally = await persistOutcome(getDb(), id, {
        kind: 'noise',
        result: buildResultFromPayload(noisePayload),
      })
      expect(tally.aiSucceeded).toBe(1)
      expect(tally.draftsUpdated).toBe(1)
      expect(tally.draftsInserted).toBe(0)

      const after = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(after).toHaveLength(1)
      expect(after[0]!.status).toBe('superseded')

      const mail = await testDb
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
      expect(mail[0]!.classification).toBe('noise')
      expect(mail[0]!.status).toBe('ai_done')
    })

    it('does NOT supersede approved or rejected drafts on a noise re-classification', async () => {
      // Operator-owned terminal states. Even if AI now says noise, we leave
      // the audit trail intact — flipping `approved` to `superseded` would
      // silently overwrite a human decision.
      const noisePayload = await loadPayload('newsletter.expected.json')
      const id = await insertTestMail({
        messageId: '<approved-stays@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      // Seed an approved draft directly.
      await testDb.insert(tournamentDrafts).values({
        messageId: id,
        status: 'approved',
        confidence: '0.95',
        isCorrection: false,
        referencesSubject: null,
        extractedPayload: {},
        aiRawResponse: null,
        promptVersion: 'fixture-1.0',
        aiModel: 'fixture',
        aiTokensInput: null,
        aiTokensOutput: null,
        aiCostUsd: null,
      })

      const tally = await persistOutcome(getDb(), id, {
        kind: 'noise',
        result: buildResultFromPayload(noisePayload),
      })
      // No draft mutation because the existing draft is `approved`, not
      // `pending_review`/`ai_failed`.
      expect(tally.draftsUpdated).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts[0]!.status).toBe('approved')
    })

    it('preserves an existing approved draft when re-extract finds tournament', async () => {
      // Reextract scenario: an admin already approved this draft in PR4 UI.
      // A prompt-version bump triggers re-classification; AI says tournament
      // (consistent with the original verdict). Without the upsertDraft
      // guard, status would silently flip back to `pending_review`, erasing
      // the human decision. We expect: no draft mutation, draftsPreserved=1.
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<approved-tournament@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      // Seed an approved draft.
      await testDb.insert(tournamentDrafts).values({
        messageId: id,
        status: 'approved',
        confidence: '0.95',
        isCorrection: false,
        referencesSubject: null,
        extractedPayload: payload,
        aiRawResponse: null,
        promptVersion: 'fixture-1.0',
        aiModel: 'fixture',
        aiTokensInput: null,
        aiTokensOutput: null,
        aiCostUsd: null,
      })

      const tally = await persistOutcome(getDb(), id, {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      })
      expect(tally.draftsPreserved).toBe(1)
      expect(tally.draftsInserted).toBe(0)
      expect(tally.draftsUpdated).toBe(0)
      expect(tally.aiSucceeded).toBe(1)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(1)
      expect(drafts[0]!.status).toBe('approved')
    })

    it('preserves an existing rejected draft when re-extract finds tournament', async () => {
      // Same shape as the approved case: a `rejected` draft is operator-owned
      // and must survive a stale AI re-run without being clobbered back to
      // `pending_review`.
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<rejected-tournament@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      await testDb.insert(tournamentDrafts).values({
        messageId: id,
        status: 'rejected',
        confidence: '0.40',
        isCorrection: false,
        referencesSubject: null,
        extractedPayload: payload,
        aiRawResponse: null,
        promptVersion: 'fixture-1.0',
        aiModel: 'fixture',
        aiTokensInput: null,
        aiTokensOutput: null,
        aiCostUsd: null,
      })

      const tally = await persistOutcome(getDb(), id, {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      })
      expect(tally.draftsPreserved).toBe(1)
      expect(tally.draftsUpdated).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts[0]!.status).toBe('rejected')
    })

    it('preserves an approved draft even when re-extract fails (BrokenLLM)', async () => {
      // The failed branch in persistOutcome also calls upsertDraft (to write
      // the raw error). It must respect the same approved/rejected guard, or
      // a transient API failure during reextract would silently flip an
      // approved row to `ai_failed` and lose the audit trail.
      const id = await insertTestMail({
        messageId: '<approved-then-fail@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      await testDb.insert(tournamentDrafts).values({
        messageId: id,
        status: 'approved',
        confidence: '0.95',
        isCorrection: false,
        referencesSubject: null,
        extractedPayload: {},
        aiRawResponse: null,
        promptVersion: 'fixture-1.0',
        aiModel: 'fixture',
        aiTokensInput: null,
        aiTokensOutput: null,
        aiCostUsd: null,
      })

      const tally = await persistOutcome(getDb(), id, {
        kind: 'failed',
        rawResponse: 'Error: BrokenLLMExtractor: forced failure',
        reason: 'LLM call or Zod validation failed twice',
      })
      expect(tally.draftsPreserved).toBe(1)
      expect(tally.draftsInserted).toBe(0)
      expect(tally.aiFailed).toBe(1)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts[0]!.status).toBe('approved')
      // aiRawResponse stays at the original NULL; the failure raw response
      // does NOT leak into the approved row.
      expect(drafts[0]!.aiRawResponse).toBeNull()

      // Mail status still reflects the latest verdict so the inbox UI can
      // surface that the model is now failing on this thread; the draft
      // audit trail is independent of mail status.
      const mail = await testDb
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
      expect(mail[0]!.status).toBe('ai_failed')
    })

    it('still updates a superseded draft on tournament re-extract (allowed promotion)', async () => {
      // `superseded` is set automatically by the noise branch when AI flips
      // a previous positive verdict to noise. It is NOT an operator-owned
      // state, so a later AI re-run that flips back to tournament must be
      // allowed to refresh the draft to `pending_review`. The guard in
      // upsertDraft only protects approved/rejected.
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<superseded-revived@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      await testDb.insert(tournamentDrafts).values({
        messageId: id,
        status: 'superseded',
        confidence: '0.50',
        isCorrection: false,
        referencesSubject: null,
        extractedPayload: {},
        aiRawResponse: null,
        promptVersion: 'fixture-0.9',
        aiModel: 'fixture',
        aiTokensInput: null,
        aiTokensOutput: null,
        aiCostUsd: null,
      })

      const tally = await persistOutcome(getDb(), id, {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      })
      expect(tally.draftsUpdated).toBe(1)
      expect(tally.draftsPreserved).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts[0]!.status).toBe('pending_review')
    })

    it('returns aiSkipped tally and writes nothing when outcome is skipped_noise', async () => {
      const id = await insertTestMail({
        messageId: '<persist-skipped@example.com>',
        subject: NEWSLETTER_SUBJECT,
        classification: 'noise',
      })
      const outcome: ClassifyOutcome = { kind: 'skipped_noise' }

      const tally = await persistOutcome(getDb(), id, outcome)

      expect(tally.aiSkipped).toBe(1)
      expect(tally.draftsInserted).toBe(0)
      expect(tally.draftsUpdated).toBe(0)
      expect(tally.aiSucceeded).toBe(0)
      expect(tally.aiFailed).toBe(0)

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(0)
    })
  })
})
