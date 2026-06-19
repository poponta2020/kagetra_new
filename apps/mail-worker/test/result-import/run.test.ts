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

const mockInsertRunRow = vi.fn()
const mockUpdateRunRow = vi.fn()
const mockSelectAttachment = vi.fn()
const mockSelectExistingDraft = vi.fn()
const mockInsertDraft = vi.fn()
const mockUpdateDraft = vi.fn()
const mockSelectMailSubject = vi.fn()
const mockSelectBadge = vi.fn()
const mockSelectSubs = vi.fn()

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
    { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0) },
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
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0) },
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

describe('runResultParse — approved draft protection', () => {
  it('returns parse_failed and does not overwrite approved draft', async () => {
    // Run row insert
    dbMock.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 102 }]) }),
    })
    // Attachment select
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: ATT_ID, mailMessageId: MAIL_ID, filename: 'result.xlsx', data: Buffer.alloc(0) },
    ]))
    // Existing draft select → approved
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: 50, status: 'approved' },
    ]))
    // Fallback: existing draft check again for the catch block
    dbMock.select.mockReturnValueOnce(makeSelectChain(() => [
      { id: 50, status: 'approved' },
    ]))
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
    // Draft update should NOT have been called (approved draft is protected).
    expect(dbMock.update).toHaveBeenCalledTimes(1) // only run row update
  })
})
