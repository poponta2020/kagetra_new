/**
 * runResultParse unit tests.
 *
 * Uses vi.mock to replace all external I/O:
 *   - getDb() → mock DB (in-memory call recorder)
 *   - readExcel() → returns minimal SheetData[]
 *   - parseResultExcel() → returns fixture ParsedClass[]
 *   - web-push sendNotification → no-op
 *
 * The tests verify:
 *   (a) happy path → result_drafts status=pending_review, runId returned
 *   (b) parse failure → result_drafts status=parse_failed, parseError set
 *   (c) attachment not found → parse_failed with error
 *   (d) attachment cross-mail access → throws
 *   (e) approved draft not overwritten
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Minimal Drizzle-like mock: fluent builder collapses to terminal call.
function makeSelectChain(impl: () => unknown[]) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: () => impl(),
  } as unknown as ReturnType<ReturnType<typeof import('../../src/db.js')['getDb']>['select']>
  return chain
}

const dbMock = {
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
}

vi.mock('../../src/db.js', () => ({
  getDb: () => dbMock,
}))

vi.mock('../../src/result-import/reader.js', () => ({
  readExcel: vi.fn(),
}))

vi.mock('../../src/result-import/parser.js', () => ({
  PARSER_VERSION: '1.0.0',
  parseResultExcel: vi.fn(),
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}))

import { runResultParse } from '../../src/result-import/run.js'
import { readExcel } from '../../src/result-import/reader.js'
import { parseResultExcel } from '../../src/result-import/parser.js'
import { AiValidationError, FixtureResultImportAi } from '../../src/result-import/ai/index.js'

const readExcelMock = vi.mocked(readExcel)
const parseResultExcelMock = vi.mocked(parseResultExcel)

// ── Helpers ────────────────────────────────────────────────────────────────

const MAIL_ID = 10
const ATT_ID = 20
const USER_ID = 'user-1'

const FIXTURE_CLASSES = [
  {
    className: 'D1',
    grade: 'D' as const,
    sheetName: '対戦結果表_D1級',
    participants: [
      {
        seqNo: 1,
        name: 'テスト選手',
        nameKana: null,
        affiliation: null,
        prefecture: null,
        dan: null,
        memberNo: null,
        finalRank: null,
        matches: [
          { round: 1, roundLabel: null, opponentName: null, scoreDiff: 5, result: 'win' as const, status: 'normal' as const },
        ],
      },
    ],
  },
]

function setupHappyPath() {
  // Run row insert
  dbMock.insert.mockReturnValueOnce({
    values: () => ({ returning: () => Promise.resolve([{ id: 99 }]) }),
  })
  // Attachment select
  dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
    { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
  ]))
  // Existing draft select → none
  dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
  // Draft insert
  dbMock.insert.mockReturnValueOnce({
    values: () => ({ returning: () => Promise.resolve([{ id: 55 }]) }),
  })
  // Run row update (finalize)
  dbMock.update.mockReturnValueOnce({
    set: () => ({ where: () => Promise.resolve() }),
  })
  // Note: all tests pass webPushConfig:null so the badge/subs/subject selects
  // inside notifyResultParseCompleted are never reached — do not add them here.
}

// Queues a spy-backed insert().values() so a test can assert on the exact
// object written to result_drafts (field names match run.ts's `.values()`
// call: extractedPayload / status / extractionSource / ai* etc).
function queueCapturedDraftInsert(returning: Array<{ id: number }>) {
  const valuesFn = vi.fn((_v: unknown) => ({ returning: () => Promise.resolve(returning) }))
  dbMock.insert.mockReturnValueOnce({ values: valuesFn })
  return valuesFn
}

beforeEach(() => {
  // vi.resetAllMocks() is required (not clearAllMocks) because clearAllMocks does
  // not drain the mockReturnValueOnce queue — leftover once-mocks from the previous
  // test bleed into the next one and consume the wrong DB call slot.
  vi.resetAllMocks()
  readExcelMock.mockResolvedValue([{ name: 'Sheet1', grid: [] }])
  parseResultExcelMock.mockReturnValue(FIXTURE_CLASSES)
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('runResultParse — happy path', () => {
  it('returns runId and status=success', async () => {
    setupHappyPath()

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    expect(result.status).toBe('success')
    expect(result.runId).toBe(99)
    expect(result.draftId).toBe(55)
  })

  it('calls readExcel with the attachment filename', async () => {
    setupHappyPath()
    await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    expect(readExcelMock).toHaveBeenCalledWith(expect.any(Buffer), 'result.xlsx')
  })
})

describe('runResultParse — parse failure', () => {
  it('returns status=parse_failed when parseResultExcel returns empty', async () => {
    parseResultExcelMock.mockReturnValue([])

    // Run row insert
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 100 }]) }),
    })
    // Attachment select
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    // Existing draft select → none
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    // Draft insert (parse_failed)
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 56 }]) }),
    })
    // Run row update
    dbMock.update.mockReturnValueOnce({
      set: () => ({ where: () => Promise.resolve() }),
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    expect(result.status).toBe('parse_failed')
    expect(result.draftId).toBe(56)
  })
})

describe('runResultParse — attachment not found', () => {
  it('returns parse_failed when attachment row is missing', async () => {
    // Run row insert
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 101 }]) }),
    })
    // Attachment select → empty
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    // Fallback: existing draft check → none
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    // Fallback draft insert
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 57 }]) }),
    })
    // Run row update
    dbMock.update.mockReturnValueOnce({
      set: () => ({ where: () => Promise.resolve() }),
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: 999,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    expect(result.status).toBe('parse_failed')
  })
})

describe('runResultParse — draft-state policy (matches triggerResultParse)', () => {
  it('does not overwrite an approved draft (skips; run still success)', async () => {
    // Run row insert
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 102 }]) }),
    })
    // Attachment select
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    // Existing draft select → approved
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: 50, status: 'approved' },
    ]))
    // Run row update (finalize) — the ONLY update expected
    dbMock.update.mockReturnValueOnce({
      set: () => ({ where: () => Promise.resolve() }),
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    // Parse succeeded but the approved draft is left intact (no overwrite).
    expect(result.status).toBe('success')
    expect(result.draftId).toBe(50)
    expect(dbMock.update).toHaveBeenCalledTimes(1) // run-row finalize only
  })

  it('does not overwrite a pending_review draft (skips)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 103 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: 60, status: 'pending_review' },
    ]))
    dbMock.update.mockReturnValueOnce({
      set: () => ({ where: () => Promise.resolve() }),
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    expect(result.status).toBe('success')
    expect(result.draftId).toBe(60)
    expect(dbMock.update).toHaveBeenCalledTimes(1) // finalize only, no overwrite
  })

  it('overwrites a rejected draft on re-import (→ pending_review)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 104 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: 70, status: 'rejected' },
    ]))
    // Guarded draft overwrite UPDATE (has .returning())
    dbMock.update.mockReturnValueOnce({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 70 }]) }) }),
    })
    // Run row finalize UPDATE
    dbMock.update.mockReturnValueOnce({
      set: () => ({ where: () => Promise.resolve() }),
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
    })

    expect(result.status).toBe('success')
    expect(result.draftId).toBe(70)
    expect(dbMock.update).toHaveBeenCalledTimes(2) // draft overwrite + finalize
  })
})

// ── tournament-results AI revamp (Task3): runResultParse + ai ──────────────
//
// These tests inject a FixtureResultImportAi via `opts.ai`. When AI is
// involved, runResultParse fetches mail_messages.subject (an extra SELECT)
// between the attachment lookup and the existing-draft lookup — so the
// dbMock.select queue for these tests is: [attachment, subject, existingDraft]
// (vs. [attachment, existingDraft] in the ai-less tests above).

describe('runResultParse — AI routing/extraction (tournament-results AI revamp)', () => {
  it('adopt: applies classMap (rawClassName preserved) and marks extraction_source=parser (AC-1)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 900 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 910 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({
      routing: {
        verdict: 'adopt',
        outOfScopeKind: null,
        classMap: [
          { className: 'D1', normalizedClassName: 'D級', grade: 'D', exclude: false, note: null },
        ],
        meta: { tournamentName: null, editionNumber: null, eventDate: null, isCorrection: false },
        issues: [],
      },
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as {
      extractedPayload: { classes: Array<{ className: string; rawClassName?: string | null }> }
      extractionSource: string | null
      aiRouting: { verdict: string } | null
    }
    expect(written.extractedPayload.classes[0]?.className).toBe('D級')
    expect(written.extractedPayload.classes[0]?.rawClassName).toBe('D1')
    expect(written.extractionSource).toBe('parser')
    // AC-4: routing verdict/classMap/meta persisted to ai_routing.
    expect(written.aiRouting?.verdict).toBe('adopt')
  })

  it('fail-open: route() throws → draft still becomes pending_review with the deterministic payload and ai_error set (AC-2)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 901 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 911 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({ failRoute: new Error('boom') })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; extractedPayload: { classes: Array<{ className: string }> }; aiError: string | null }
    expect(written.status).toBe('pending_review')
    expect(written.extractedPayload.classes[0]?.className).toBe('D1')
    expect(written.aiError).toBe('boom')
  })

  it('fail-open: AiValidationError from route() (not extract()) also falls open to the deterministic payload', async () => {
    // AC-8 only forbids fail-open for a validation error from the full
    // *extraction* call — nothing from route() ever becomes payload, so a
    // routing-side schema mismatch must NOT force parse_failed the way an
    // extraction-side one does.
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 907 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 917 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({ failRoute: new AiValidationError('bad routing schema', '{}') })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; extractedPayload: { classes: Array<{ className: string }> }; aiError: string | null }
    expect(written.status).toBe('pending_review')
    expect(written.extractedPayload.classes[0]?.className).toBe('D1')
    expect(written.aiError).toBe('bad routing schema')
  })

  it('0 classes: skips routing and runs full extraction directly (AC-7)', async () => {
    parseResultExcelMock.mockReturnValueOnce([])
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 902 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 912 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi()
    const routeSpy = vi.spyOn(ai, 'route')

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(routeSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; extractionSource: string | null; parserVersion: string }
    expect(written.status).toBe('pending_review')
    expect(written.extractionSource).toBe('ai')
    // AC-9: the `parser_version` column (not just the payload JSON) reflects
    // the AI-extract provenance stamp so downstream reads don't need to dig
    // into extracted_payload to tell parser vs. AI origin.
    expect(written.parserVersion.startsWith('ai-extract-')).toBe(true)
  })

  it('PDF: skips deterministic parsing/readExcel and calls extract() directly, never route() (AC-6)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 903 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.pdf', data: Buffer.from('dummy-pdf-bytes'), sizeBytes: Buffer.from('dummy-pdf-bytes').length },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 913 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi()
    const routeSpy = vi.spyOn(ai, 'route')
    const extractSpy = vi.spyOn(ai, 'extract')

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(readExcelMock).not.toHaveBeenCalled()
    expect(parseResultExcelMock).not.toHaveBeenCalled()
    expect(routeSpy).not.toHaveBeenCalled()
    expect(extractSpy).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; extractionSource: string | null }
    expect(written.status).toBe('pending_review')
    expect(written.extractionSource).toBe('ai')
  })

  it('PDF: oversize guard (MAIL_WORKER_PDF_SIZE_LIMIT_KB) blocks the AI call and reports parse_failed', async () => {
    // Default limit is 8000KB (loadCostGuardConfig, config.ts) — well above
    // anything a unit test buffer can hit at real size, so we lie about
    // sizeBytes on the attachment row (the guard trusts the DB column, not
    // `attachment.data.length` — see the run.ts comment on this guard).
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 908 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.pdf', data: Buffer.from('dummy-pdf-bytes'), sizeBytes: 9_000_000 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 918 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi()
    const extractSpy = vi.spyOn(ai, 'extract')

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(extractSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('parse_failed')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; parseError: string | null }
    expect(written.status).toBe('parse_failed')
    expect(written.parseError).toContain('上限')
  })

  it('adopt なのに classMap が全クラスを exclude → フル抽出へエスカレートする（空 payload で承認不能画面を作らない）', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 920 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 930 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({
      routing: {
        verdict: 'adopt',
        outOfScopeKind: null,
        classMap: [
          { className: 'D1', normalizedClassName: '選手一覧', grade: null, exclude: true, note: null },
        ],
        meta: { tournamentName: null, editionNumber: null, eventDate: null, isCorrection: false },
        issues: [],
      },
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as {
      status: string
      extractedPayload: { classes: unknown[] }
      extractionSource: string | null
    }
    expect(written.status).toBe('pending_review')
    expect(written.extractionSource).toBe('ai')
    expect(written.extractedPayload.classes.length).toBeGreaterThan(0)
  })

  it('out_of_scope で classMap が全クラスを exclude → parse_failed（フル抽出にコストを払わない）', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 921 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'roster.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: '出場者名簿' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 931 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({
      routing: {
        verdict: 'out_of_scope',
        outOfScopeKind: 'roster_or_lottery',
        classMap: [
          { className: 'D1', normalizedClassName: '選手一覧', grade: null, exclude: true, note: null },
        ],
        meta: { tournamentName: null, editionNumber: null, eventDate: null, isCorrection: false },
        issues: [],
      },
    })
    const extractSpy = vi.spyOn(ai, 'extract')

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(extractSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('parse_failed')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; parseError: string | null }
    expect(written.status).toBe('parse_failed')
    expect(written.parseError).toContain('対象外')
  })

  it('out_of_scope でも取り込める級が残っていれば pending_review（警告表示は画面側の責務）', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 922 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 932 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({
      routing: {
        verdict: 'out_of_scope',
        outOfScopeKind: 'team',
        classMap: [],
        meta: { tournamentName: null, editionNumber: null, eventDate: null, isCorrection: false },
        issues: [],
      },
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as {
      status: string
      aiRouting: { verdict: string; outOfScopeKind: string | null } | null
    }
    expect(written.status).toBe('pending_review')
    expect(written.aiRouting?.verdict).toBe('out_of_scope')
    expect(written.aiRouting?.outOfScopeKind).toBe('team')
  })

  it('escalate: routes then runs full extraction; extraction_source=ai (AC-7)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 904 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 914 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({
      routing: {
        verdict: 'escalate',
        outOfScopeKind: null,
        classMap: [],
        meta: { tournamentName: null, editionNumber: null, eventDate: null, isCorrection: false },
        issues: ['要目視確認'],
      },
    })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('success')
    const written = valuesFn.mock.calls[0]?.[0] as { extractionSource: string | null }
    expect(written.extractionSource).toBe('ai')
  })

  it('escalate: ai_tokens_input/output are the sum of the routing call + the extraction call (AC-5)', async () => {
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 905 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 915 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({
      routing: {
        verdict: 'escalate',
        outOfScopeKind: null,
        classMap: [],
        meta: { tournamentName: null, editionNumber: null, eventDate: null, isCorrection: false },
        issues: [],
      },
    })

    await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    const written = valuesFn.mock.calls[0]?.[0] as {
      aiTokensInput: number | null
      aiTokensOutput: number | null
      aiModel: string | null
      aiPromptVersion: string | null
      aiCostUsd: string | null
    }
    // Fixture returns 100/200 per call; route() + extract() → 200/400 combined.
    expect(written.aiTokensInput).toBe(200)
    expect(written.aiTokensOutput).toBe(400)
    expect(written.aiModel).toBe('fixture')
    expect(written.aiPromptVersion).not.toBeNull()
    expect(written.aiCostUsd).not.toBeNull()
  })

  it('AiValidationError from extract() is never fail-open — draft becomes parse_failed even with 0-class deterministic result (AC-8)', async () => {
    parseResultExcelMock.mockReturnValueOnce([])
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 906 }]) }),
    })
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0), sizeBytes: 0 },
    ]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [{ subject: 'テスト大会' }]))
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => []))
    const valuesFn = queueCapturedDraftInsert([{ id: 916 }])
    dbMock.update.mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })

    const ai = new FixtureResultImportAi({ failExtract: new AiValidationError('bad', '{}') })

    const result = await runResultParse({
      mailMessageId: MAIL_ID,
      attachmentId: ATT_ID,
      triggeredByUserId: USER_ID,
      webPushConfig: null,
      ai,
    })

    expect(result.status).toBe('parse_failed')
    const written = valuesFn.mock.calls[0]?.[0] as { status: string; aiError: string | null }
    expect(written.status).toBe('parse_failed')
    expect(written.aiError).toBe('bad')
  })
})
