import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AC-20 must verify the actual `messages.create` request body, not just what
 * `classifyMail` hands to a stub `LLMExtractor`. Mocking `@anthropic-ai/sdk`
 * here (same `vi.hoisted` pattern as `anthropic.test.ts`) lets the attachment-
 * selection describe block below run classifier → `AnthropicExtractor` →
 * `messages.create` end-to-end and assert on the captured call args.
 */
const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages = { create: messagesCreate }
      constructor(_opts: unknown) {
        // capture nothing — the call shape under test is on `messages.create`.
      }
    },
  }
})

import { eq } from 'drizzle-orm'
import { mailAttachments, mailMessages, tournamentDrafts } from '@kagetra/shared/schema'
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
import { AnthropicExtractor } from '../../src/classify/llm/anthropic.js'
import {
  LLMExtractorError,
  type LLMExtractionInput,
  type LLMExtractionResult,
  type LLMExtractor,
} from '../../src/classify/llm/types.js'
import { resetConfigForTests } from '../../src/config.js'
import {
  ANTHROPIC_REQUEST_LIMIT_BYTES,
  ATTACHMENT_TOTAL_LIMIT_BYTES,
} from '../../src/classify/attachment-budget.js'
import { closeTestDb, testDb, truncateMailTables } from '../test-db.js'
import { closeDb, getDb } from '../../src/db.js'

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/', import.meta.url))

// Subjects must match the on-disk fixture wrappers in test/fixtures/llm/.
// `loadFixturesFromDir` is the source of truth at runtime — these constants
// are the convenience handles tests use to insert the right `mail_messages`
// row before invoking the classifier.
const TOURNAMENT_SUBJECT = '[taikai-ajka:828] 第65回全日本選手権大会/ご案内'
// Deliberately absent from the fixture map — used by the pre-filter /
// skipped_noise paths, which must never reach the extractor at all.
const UNMATCHED_SUBJECT = 'Weekly Update: New Features Available'
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

interface InsertPdfOpts {
  mailMessageId: number
  filename?: string
  sizeBytes: number
}

// Minimal "is this a PDF" prefix so any downstream PDF parser sees something
// vaguely real. The cost guard never reads the bytes — it short-circuits on
// `sizeBytes` — so we don't bother filling the buffer with realistic content.
// Returns the inserted `mail_attachments.id` so attachment-selection tests
// can build a `selectedAttachmentIds` array against a real id.
async function insertTestPdf(opts: InsertPdfOpts): Promise<number> {
  const inserted = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: opts.mailMessageId,
      filename: opts.filename ?? '案内.pdf',
      contentType: 'application/pdf',
      sizeBytes: opts.sizeBytes,
      // bytea content is irrelevant for the size-guard path; a 1-byte buffer
      // keeps the row small and the insert fast. The classifier never gets to
      // base64-encode it because the guard fires first.
      data: Buffer.from([0x25]),
      extractedText: null,
      extractionStatus: 'pending',
    })
    .returning({ id: mailAttachments.id })
  return inserted[0]!.id
}

interface InsertTextAttachmentOpts {
  mailMessageId: number
  filename?: string
  extractedText: string
}

// DOCX-shaped attachment that already has `extractedText` populated —
// exercises the `kind: 'text'` branch of `attachmentsForLlm` rather than the
// PDF document-block branch.
async function insertTestTextAttachment(
  opts: InsertTextAttachmentOpts,
): Promise<number> {
  const inserted = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: opts.mailMessageId,
      filename: opts.filename ?? '名簿.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: opts.extractedText.length,
      data: Buffer.from([0x50]),
      extractedText: opts.extractedText,
      extractionStatus: 'extracted',
    })
    .returning({ id: mailAttachments.id })
  return inserted[0]!.id
}

function buildAnthropicSuccessResponse() {
  return {
    content: [
      {
        type: 'tool_use' as const,
        name: 'record_extraction',
        id: 'toolu_classifier_test',
        input: {
          reason: 'unit-test fixture',
          source_mismatch: null,
          events: [
            {
              unit_key: 'u1',
              event_date: null,
              eligible_grades: null,
              formal_name: null,
              venue: null,
              payment_deadline: null,
              payment_deadline_kind: '記載なし',
              payment_info_text: null,
              payment_method: null,
              entry_method: null,
              organizer_text: null,
              entry_deadline: null,
              kind: null,
              capacity_total: null,
              capacity_a: null,
              capacity_b: null,
              capacity_c: null,
              capacity_d: null,
              capacity_e: null,
              official: null,
            },
          ],
        },
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

interface AnthropicUserContentBlock {
  type: string
  text?: string
  title?: string
}

function getAnthropicUserContent(): AnthropicUserContentBlock[] {
  const args = messagesCreate.mock.calls.at(-1)![0] as {
    messages: Array<{ role: string; content: AnthropicUserContentBlock[] }>
  }
  return args.messages[0]!.content
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
        expect(outcome.result.parsed.events[0]?.formal_name).toBe('第65回全日本選手権大会')
        expect(outcome.result.parsed.events[0]?.payment_deadline_kind).toBe('日付あり')
      }
    })

    it('always returns a tournament outcome — the AI no longer votes on classification', async () => {
      // 3.0.0: the admin already decided this is an announcement before
      // pressing 「会で流す」, so even a subject the extractor knows nothing
      // about comes back as `tournament` (with an empty-but-valid unit).
      const fixtures = await buildFixtureMap()
      const llm = new FixtureLLMExtractor(fixtures)
      const id = await insertTestMail({
        messageId: '<unmatched-1@example.com>',
        subject: UNMATCHED_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, llm)

      expect(outcome.kind).toBe('tournament')
      if (outcome.kind === 'tournament') {
        expect(outcome.result.parsed.events).toHaveLength(1)
      }
    })

    it('short-circuits to skipped_noise when pre-filter set classification=noise (force=false)', async () => {
      let calls = 0
      const llm = new FixtureLLMExtractor(new Map())
      const wrapped: LLMExtractor = {
        modelId: llm.modelId,
        async extract(input: Parameters<typeof llm.extract>[0]) {
          calls += 1
          return llm.extract(input)
        },
      }
      const id = await insertTestMail({
        messageId: '<noise-1@example.com>',
        subject: UNMATCHED_SUBJECT,
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

    it('extracts a correction-style mail as an ordinary announcement (no correction flags)', async () => {
      // 3.0.0 removed `is_correction` / `references_subject` — 訂正版 handling
      // is human work now. The mail still has to extract normally.
      const fixtures = await buildFixtureMap()
      const llm = new FixtureLLMExtractor(fixtures)
      const id = await insertTestMail({
        messageId: '<correction-1@example.com>',
        subject: CORRECTION_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, llm)

      expect(outcome.kind).toBe('tournament')
      if (outcome.kind === 'tournament') {
        expect(outcome.result.parsed.events[0]?.entry_deadline).toBe('2026-05-07')
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
        // The attempted model comes from `llm.modelId` (review r3 Should
        // fix). `BrokenLLMExtractor` advertises itself as 'broken'.
        expect(outcome.attemptedModel).toBe('broken')
      }
    })

    it("preserves the provider's actual response on rawResponse when an LLMExtractorError is thrown", async () => {
      // Review r3 Should fix: the failed branch used to put only
      // `error.message` into `rawResponse`, so a reviewer of an `ai_failed`
      // draft would see "Anthropic response missing tool_use block ..."
      // with no clue what the model actually returned. The classifier now
      // reads `rawResponse` directly off any `LLMExtractorError`.
      class CapturedResponseError extends LLMExtractorError {
        constructor() {
          super('no tool_use', JSON.stringify([{ type: 'text', text: 'I refuse' }]))
        }
      }
      class CapturingLLM implements LLMExtractor {
        readonly modelId = 'test-model-7'
        async extract(_input: LLMExtractionInput): Promise<LLMExtractionResult> {
          throw new CapturedResponseError()
        }
      }
      const id = await insertTestMail({
        messageId: '<capture-raw@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      const outcome = await classifyMail(getDb(), id, new CapturingLLM())

      expect(outcome.kind).toBe('failed')
      if (outcome.kind === 'failed') {
        // The text the model "actually returned" survives all the way to
        // the failed outcome instead of being clobbered by a generic
        // "no tool_use" message.
        expect(outcome.rawResponse).toContain('I refuse')
        expect(outcome.rawResponse).not.toContain('no tool_use')
        // attemptedModel is captured from `llm.modelId` even when the
        // extractor never produces a result.
        expect(outcome.attemptedModel).toBe('test-model-7')
      }
    })

    it('throws when the message id does not exist (caller bug, not row-level state)', async () => {
      const llm = new FixtureLLMExtractor(new Map())
      await expect(classifyMail(getDb(), 9_999_999, llm)).rejects.toThrow(
        /not found/,
      )
    })

    describe('lazy in-memory extraction fallback (Issue #133)', () => {
      // Rows ingested BEFORE a format became supported sit at `unsupported`
      // with NULL extracted_text — the 多摩大会 .doc was invisible to the AI
      // even via the reextract path. The classifier now re-runs the extractor
      // in memory for such rows, without persisting anything (pure-read+LLM).
      const DOC_FIXTURE_PATH = fileURLToPath(
        new URL('../fixtures/attachments/legacy-word-announcement.doc', import.meta.url),
      )

      async function insertDocAttachment(
        mailMessageId: number,
        extractionStatus: 'unsupported' | 'failed',
      ): Promise<void> {
        const docBytes = await readFile(DOC_FIXTURE_PATH)
        await testDb.insert(mailAttachments).values({
          mailMessageId,
          filename: '案内.doc',
          contentType: 'application/msword',
          sizeBytes: docBytes.length,
          data: docBytes,
          extractedText: null,
          extractionStatus,
        })
      }

      function capturingLlm(
        inner: LLMExtractor,
        captured: LLMExtractionInput[],
      ): LLMExtractor {
        return {
          modelId: inner.modelId,
          async extract(input) {
            captured.push(input)
            return inner.extract(input)
          },
        }
      }

      it('re-extracts an unsupported-at-ingest .doc and forwards its text to the LLM', async () => {
        const fixtures = await buildFixtureMap()
        const captured: LLMExtractionInput[] = []
        const llm = capturingLlm(new FixtureLLMExtractor(fixtures), captured)
        const id = await insertTestMail({
          messageId: '<doc-fallback-1@example.com>',
          subject: TOURNAMENT_SUBJECT,
        })
        await insertDocAttachment(id, 'unsupported')

        const outcome = await classifyMail(getDb(), id, llm)

        expect(outcome.kind).toBe('tournament')
        expect(captured).toHaveLength(1)
        const sent = captured[0]!.attachments
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ kind: 'text', filename: '案内.doc' })
        expect((sent[0] as { kind: 'text'; text: string }).text).toContain(
          '申込締切: 2026年7月31日（金）必着',
        )

        // classifyMail stays pure-read+LLM: the fallback must NOT update the
        // row — extraction_status keeps reflecting what ingest saw.
        const rows = await testDb
          .select({
            extractedText: mailAttachments.extractedText,
            extractionStatus: mailAttachments.extractionStatus,
          })
          .from(mailAttachments)
          .where(eq(mailAttachments.mailMessageId, id))
        expect(rows).toHaveLength(1)
        expect(rows[0]!.extractedText).toBeNull()
        expect(rows[0]!.extractionStatus).toBe('unsupported')
      })

      it('does not retry failed-at-ingest attachments', async () => {
        const fixtures = await buildFixtureMap()
        const captured: LLMExtractionInput[] = []
        const llm = capturingLlm(new FixtureLLMExtractor(fixtures), captured)
        const id = await insertTestMail({
          messageId: '<doc-fallback-2@example.com>',
          subject: TOURNAMENT_SUBJECT,
        })
        await insertDocAttachment(id, 'failed')

        const outcome = await classifyMail(getDb(), id, llm)

        expect(outcome.kind).toBe('tournament')
        expect(captured).toHaveLength(1)
        expect(captured[0]!.attachments).toHaveLength(0)
      })
    })

    describe('PDF サイズ予算', () => {
      // Lives in its own describe so the env stub doesn't bleed into other
      // tests in this file. Each `it` may set its own threshold; afterEach
      // restores process.env and clears the cached config so the next test
      // (here or elsewhere) sees the un-stubbed default.
      afterEach(() => {
        vi.unstubAllEnvs()
        resetConfigForTests()
      })

      // `MAIL_WORKER_PDF_SIZE_LIMIT_KB` はかつてここで `oversize_skipped` を
      // 返していたが、値の根拠はコストの目安であって「送れるサイズ」ではない。
      // 管理者が中身を見て選んだ PDF を送信不能にしていたのを、選択ダイアログ
      // 側の注意書き＋確認ステップへ移した。classifier はもうこの env を見ない。
      it('1件ごとのサイズでは止めない: 目安を大きく超える PDF でもそのまま AI へ渡す', async () => {
        vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '500')
        resetConfigForTests()

        const fixtures = await buildFixtureMap()
        const llm = new FixtureLLMExtractor(fixtures)
        const id = await insertTestMail({
          messageId: '<oversize-pdf@example.com>',
          subject: TOURNAMENT_SUBJECT,
        })
        // 目安 500KB の 20 倍。合計予算（23.25MiB）には遠く届かないので通る。
        await insertTestPdf({ mailMessageId: id, sizeBytes: 10 * 1024 * 1024 })

        const outcome = await classifyMail(getDb(), id, llm)

        expect(outcome.kind).toBe('tournament')
      })

      it('force=true でも 1件ごとのサイズは判定材料にならない', async () => {
        vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '500')
        resetConfigForTests()

        const fixtures = await buildFixtureMap()
        const llm = new FixtureLLMExtractor(fixtures)
        const id = await insertTestMail({
          messageId: '<force-flag-oversize@example.com>',
          subject: TOURNAMENT_SUBJECT,
          classification: 'noise',
        })
        await insertTestPdf({ mailMessageId: id, sizeBytes: 10 * 1024 * 1024 })

        const outcome = await classifyMail(getDb(), id, llm, { force: true })

        expect(outcome.kind).toBe('tournament')
      })

      // 要件 §6: 1件ごとの上限を全て満たしていても、合計は Anthropic の
      // リクエスト上限 32MB を超え得る（base64 で約 4/3 に膨らむ）。
      // 正常系では Server Action と選択ダイアログが先に止めるが、**選択が
      // 未指定（NULL）の経路**——大きな PDF を何件も持つ古いメールを reextract
      // CLI にかける——ではここが唯一の砦になる。
      // 送信直前の実測ガード。PDF 合計の事前チェックは非 PDF 部分を予約枠で
      // 見積もっているだけなので、巨大な抽出テキストを持つメールでは仮定が崩れる。
      // JSON エスケープ後のバイト数で測るので、改行・引用符の増分も含まれる。
      it('本文が巨大でリクエスト全体が 32MiB を超えるなら AI を呼ばずスキップする', async () => {
        vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '0') // 1件ごとのガードは無効化
        resetConfigForTests()
        let calls = 0
        const llm: LLMExtractor = {
          modelId: 'should-not-be-called',
          async extract(_input: LLMExtractionInput): Promise<LLMExtractionResult> {
            calls += 1
            throw new Error('LLM should not be invoked over the request budget')
          },
        }
        // PDF はゼロ。本文だけで 32MiB を超えさせる（＝ PDF 合計の事前チェックは
        // 素通りする経路。実測ガードでしか止められない）。
        const id = await insertTestMail({
          messageId: '<huge-body@example.com>',
          subject: TOURNAMENT_SUBJECT,
          bodyText: 'あ'.repeat(12 * 1024 * 1024), // UTF-8 で 3 バイト/文字 = 36MiB
        })

        const outcome = await classifyMail(getDb(), id, llm)

        expect(outcome.kind).toBe('oversize_skipped')
        if (outcome.kind === 'oversize_skipped') {
          expect(outcome.limitBytes).toBe(ANTHROPIC_REQUEST_LIMIT_BYTES)
          expect(outcome.filename).toContain('リクエスト全体')
        }
        expect(calls).toBe(0)
      })

      it('合計サイズが上限を超えたら AI を呼ばずスキップする', async () => {
        // 8.5MB を 3 件で合計 25.5MB > 23.25MiB。
        let calls = 0
        const llm: LLMExtractor = {
          modelId: 'should-not-be-called',
          async extract(_input: LLMExtractionInput): Promise<LLMExtractionResult> {
            calls += 1
            throw new Error('LLM should not be invoked over the total budget')
          },
        }
        const id = await insertTestMail({
          messageId: '<total-oversize@example.com>',
          subject: TOURNAMENT_SUBJECT,
        })
        // 1件ずつなら「大きめ」の注意が出るだけで送れるサイズ。合計だけが原因。
        const bigMb = 8.5 * 1024 * 1024
        await insertTestPdf({ mailMessageId: id, filename: 'a.pdf', sizeBytes: bigMb })
        await insertTestPdf({ mailMessageId: id, filename: 'b.pdf', sizeBytes: bigMb })
        await insertTestPdf({ mailMessageId: id, filename: 'c.pdf', sizeBytes: bigMb })

        const outcome = await classifyMail(getDb(), id, llm)

        expect(outcome.kind).toBe('oversize_skipped')
        if (outcome.kind === 'oversize_skipped') {
          expect(outcome.sizeBytes).toBe(3 * bigMb)
          expect(outcome.limitBytes).toBe(ATTACHMENT_TOTAL_LIMIT_BYTES)
          // どのファイル1件でもなく「合計」が原因であることが読み取れること。
          expect(outcome.filename).toContain('合計')
        }
        expect(calls).toBe(0)
      })

      it('合計が上限内なら通常どおり分類する', async () => {
        const fixtures = await buildFixtureMap()
        const llm = new FixtureLLMExtractor(fixtures)
        const id = await insertTestMail({
          messageId: '<total-within@example.com>',
          subject: TOURNAMENT_SUBJECT,
        })
        // 3MB × 3 = 9MB < 23.25MiB。実運用の要綱 PDF はこの範囲に収まる。
        const threeMb = 3 * 1024 * 1024
        await insertTestPdf({ mailMessageId: id, filename: 'a.pdf', sizeBytes: threeMb })
        await insertTestPdf({ mailMessageId: id, filename: 'b.pdf', sizeBytes: threeMb })
        await insertTestPdf({ mailMessageId: id, filename: 'c.pdf', sizeBytes: threeMb })

        const outcome = await classifyMail(getDb(), id, llm)

        expect(outcome.kind).toBe('tournament')
      })

      it('選択で合計上限内に絞れば通る（合計ガードも選択後の集合に掛かる）', async () => {
        const fixtures = await buildFixtureMap()
        const llm = new FixtureLLMExtractor(fixtures)
        const id = await insertTestMail({
          messageId: '<total-narrowed@example.com>',
          subject: TOURNAMENT_SUBJECT,
        })
        // 3 件そろうと 25.5MB で合計超過。1 件に絞れば通る。
        const bigMb = 8.5 * 1024 * 1024
        const keep = await insertTestPdf({
          mailMessageId: id,
          filename: 'keep.pdf',
          sizeBytes: bigMb,
        })
        await insertTestPdf({ mailMessageId: id, filename: 'x.pdf', sizeBytes: bigMb })
        await insertTestPdf({ mailMessageId: id, filename: 'y.pdf', sizeBytes: bigMb })

        const outcome = await classifyMail(getDb(), id, llm, {
          selectedAttachmentIds: [keep],
        })

        expect(outcome.kind).toBe('tournament')
      })
    })

    describe('attachment selection (AC-20 / AC-30)', () => {
      // AC-20 requires checking the actual `messages.create` request body, so
      // these tests run classifyMail against a real `AnthropicExtractor`
      // instead of `FixtureLLMExtractor` / a stub `LLMExtractor`.
      beforeEach(() => {
        messagesCreate.mockReset()
        messagesCreate.mockResolvedValue(buildAnthropicSuccessResponse())
      })

      it('① attachment present but selection is empty: no document blocks, body text still reaches the text block', async () => {
        const id = await insertTestMail({
          messageId: '<ac20-case1@example.com>',
          subject: TOURNAMENT_SUBJECT,
          bodyText: 'AC-20 ケース1の本文マーカー',
        })
        await insertTestPdf({ mailMessageId: id, sizeBytes: 100 * 1024 })

        const outcome = await classifyMail(
          getDb(),
          id,
          new AnthropicExtractor({ apiKey: 'test' }),
          { selectedAttachmentIds: [] },
        )

        expect(outcome.kind).toBe('tournament')
        const content = getAnthropicUserContent()
        expect(content.filter((b) => b.type === 'document')).toHaveLength(0)
        const textBlocks = content.filter((b) => b.type === 'text')
        expect(textBlocks).toHaveLength(1)
        expect(textBlocks[0]!.text).toContain('AC-20 ケース1の本文マーカー')
      })

      it('② zero-attachment mail (selection unspecified): body text still reaches the text block', async () => {
        const id = await insertTestMail({
          messageId: '<ac20-case2@example.com>',
          subject: TOURNAMENT_SUBJECT,
          bodyText: 'AC-20 ケース2の本文マーカー',
        })

        const outcome = await classifyMail(
          getDb(),
          id,
          new AnthropicExtractor({ apiKey: 'test' }),
        )

        expect(outcome.kind).toBe('tournament')
        const content = getAnthropicUserContent()
        expect(content.filter((b) => b.type === 'document')).toHaveLength(0)
        const textBlocks = content.filter((b) => b.type === 'text')
        expect(textBlocks).toHaveLength(1)
        expect(textBlocks[0]!.text).toContain('AC-20 ケース2の本文マーカー')
      })

      it('③ only a text-kind (DOCX) attachment selected: no document blocks, text block carries body + extracted text', async () => {
        const id = await insertTestMail({
          messageId: '<ac20-case3@example.com>',
          subject: TOURNAMENT_SUBJECT,
          bodyText: 'AC-20 ケース3の本文マーカー',
        })
        // Present but unselected — must not appear anywhere in the request.
        await insertTestPdf({ mailMessageId: id, filename: '会場地図.pdf', sizeBytes: 100 * 1024 })
        const docxId = await insertTestTextAttachment({
          mailMessageId: id,
          filename: '名簿.docx',
          extractedText: 'DOCX 抽出テキストマーカー',
        })

        const outcome = await classifyMail(
          getDb(),
          id,
          new AnthropicExtractor({ apiKey: 'test' }),
          { selectedAttachmentIds: [docxId] },
        )

        expect(outcome.kind).toBe('tournament')
        const content = getAnthropicUserContent()
        expect(content.filter((b) => b.type === 'document')).toHaveLength(0)
        const textBlocks = content.filter((b) => b.type === 'text')
        expect(textBlocks).toHaveLength(1)
        expect(textBlocks[0]!.text).toContain('AC-20 ケース3の本文マーカー')
        expect(textBlocks[0]!.text).toContain('DOCX 抽出テキストマーカー')
      })

      it('④ restored selection on re-extraction: only the previously-selected PDF becomes a document block; the unselected sibling PDF is excluded (AC-30)', async () => {
        const id = await insertTestMail({
          messageId: '<ac20-case4@example.com>',
          subject: TOURNAMENT_SUBJECT,
          bodyText: 'AC-20 ケース4の本文マーカー',
        })
        const keptId = await insertTestPdf({
          mailMessageId: id,
          filename: '要綱.pdf',
          sizeBytes: 100 * 1024,
        })
        await insertTestPdf({
          mailMessageId: id,
          filename: '名簿.pdf',
          sizeBytes: 100 * 1024,
        })

        // Simulates `runManualExtract` re-reading a previously persisted
        // `tournament_drafts.selected_attachment_ids` and passing it back in
        // on 「再 AI 抽出」.
        const outcome = await classifyMail(
          getDb(),
          id,
          new AnthropicExtractor({ apiKey: 'test' }),
          { selectedAttachmentIds: [keptId] },
        )

        expect(outcome.kind).toBe('tournament')
        const content = getAnthropicUserContent()
        const documentBlocks = content.filter((b) => b.type === 'document')
        expect(documentBlocks).toHaveLength(1)
        expect(documentBlocks[0]!.title).toBe('要綱.pdf')
        const textBlocks = content.filter((b) => b.type === 'text')
        expect(textBlocks).toHaveLength(1)
        expect(textBlocks[0]!.text).toContain('AC-20 ケース4の本文マーカー')
      })
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
      // 3.0.0: confidence left the schema; the column stays but is no longer
      // written (dropping it is an explicit Non-goal).
      expect(drafts[0]!.confidence).toBeNull()
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

    // 要件 §6:「confidence / superseded_by_draft_id 列は残す。**既存行の値も残す**」。
    // 3.0.0 は confidence / is_correction / references_subject に書かなくなったが、
    // upsertDraft の UPDATE がこれらを含んでいると、2.x のドラフトを再抽出した
    // だけで過去の値が不可逆に消える。
    it('再抽出で 2.x ドラフトの confidence / is_correction / references_subject を消さない', async () => {
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<legacy-meta-preserved@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })
      // 2.x が書いた値を持つ pending_review ドラフト。
      await testDb.insert(tournamentDrafts).values({
        messageId: id,
        status: 'pending_review',
        confidence: '0.93',
        isCorrection: true,
        referencesSubject: '第65回全日本選手権大会のご案内',
        extractedPayload: {},
        aiRawResponse: null,
        promptVersion: '2.1.0',
        aiModel: 'claude-sonnet-4-6',
        aiTokensInput: null,
        aiTokensOutput: null,
        aiCostUsd: null,
      })

      const tally = await persistOutcome(getDb(), id, {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      })
      expect(tally.draftsUpdated).toBe(1)

      const after = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      // 3.0.0 が書く列は更新される。
      expect(after[0]!.promptVersion).toBe('fixture-1.0')
      expect(after[0]!.status).toBe('pending_review')
      // 廃止した3列は**そのまま残る**。
      expect(after[0]!.confidence).toBe('0.93')
      expect(after[0]!.isCorrection).toBe(true)
      expect(after[0]!.referencesSubject).toBe('第65回全日本選手権大会のご案内')
    })

    it('新規 draft では廃止した3列が DB 既定値になる（AI は値を書かない）', async () => {
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<fresh-draft-defaults@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })

      await persistOutcome(getDb(), id, {
        kind: 'tournament',
        result: buildResultFromPayload(payload),
      })

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts[0]!.confidence).toBeNull()
      expect(drafts[0]!.isCorrection).toBe(false)
      expect(drafts[0]!.referencesSubject).toBeNull()
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
      const payload = await loadPayload('tournament-announcement.expected.json')
      const id = await insertTestMail({
        messageId: '<persist-noise@example.com>',
        subject: UNMATCHED_SUBJECT,
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
        attemptedModel: 'broken',
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
      // aiModel mirrors outcome.attemptedModel (review r3 Should fix —
      // previously a hardcoded `'claude-sonnet-4-6'`).
      expect(drafts[0]!.aiModel).toBe('broken')

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
      const noisePayload = await loadPayload('tournament-announcement.expected.json')
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
      const noisePayload = await loadPayload('tournament-announcement.expected.json')
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
        attemptedModel: 'broken',
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
        subject: UNMATCHED_SUBJECT,
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

    it('flips mail.status to oversize_skipped and writes no draft on cost-guard outcome', async () => {
      const id = await insertTestMail({
        messageId: '<persist-oversize@example.com>',
        subject: TOURNAMENT_SUBJECT,
      })
      const outcome: ClassifyOutcome = {
        kind: 'oversize_skipped',
        filename: '案内.pdf',
        sizeBytes: 900 * 1024,
        limitBytes: 800 * 1024,
      }

      const tally = await persistOutcome(getDb(), id, outcome)

      // aiSkipped covers both pre-filter noise and cost-guard skip — the
      // distinction is exposed via mail.status, not the tally.
      expect(tally.aiSkipped).toBe(1)
      expect(tally.draftsInserted).toBe(0)
      expect(tally.draftsUpdated).toBe(0)
      expect(tally.aiSucceeded).toBe(0)
      expect(tally.aiFailed).toBe(0)

      const mail = await testDb
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
      expect(mail[0]!.status).toBe('oversize_skipped')

      const drafts = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.messageId, id))
      expect(drafts).toHaveLength(0)
    })
  })
})
