import { describe, expect, it } from 'vitest'
import {
  classifyRosterCandidate,
  collectRosterCandidates,
} from '../../src/roster-import/candidate.js'
import type { ParsedMailMeta } from '../../src/fetch/imap-client.js'

function mail(overrides: Partial<ParsedMailMeta> = {}): ParsedMailMeta {
  return {
    messageId: '<candidate@example.test>',
    fromAddress: 'sender@example.test',
    fromName: null,
    toAddresses: ['receiver@example.test'],
    subject: '第40回大会 A級 抽選結果',
    receivedAt: new Date('2024-08-01T00:00:00Z'),
    bodyText: '確定名簿を送付します。',
    bodyHtml: null,
    headers: {},
    imapUid: 1,
    imapBox: 'INBOX',
    attachments: [],
    attachmentSkips: [],
    ...overrides,
  }
}

describe('roster candidate classifier', () => {
  it('classifies a roster attachment deterministically and infers type/grade', () => {
    const decision = classifyRosterCandidate(mail({
      attachments: [{
        filename: '第40回大会_A級_抽選結果_確定名簿.xlsm',
        contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
        sizeBytes: 3,
        data: Buffer.from('zip'),
      }],
    }))

    expect(decision.candidate).toBe(true)
    expect(decision.inferredRosterType).toBe('confirmed')
    expect(decision.inferredGrade).toBe('A')
    expect(decision.sources).toEqual([
      expect.objectContaining({ sourceKind: 'attachment', attachmentIndex: 0 }),
    ])
  })

  it('rejects blank application forms and unrelated tournament notices', () => {
    const blank = classifyRosterCandidate(mail({
      subject: '第40回大会のご案内と申込書',
      bodyText: '空欄の申込様式を添付します。',
      attachments: [{
        filename: '申込書（空欄）.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 3,
        data: Buffer.from('zip'),
      }],
    }))
    const unrelated = classifyRosterCandidate(mail({
      subject: '会場変更のお知らせ',
      bodyText: '開始時刻が変わります。',
    }))

    expect(blank.candidate).toBe(false)
    expect(unrelated.candidate).toBe(false)
  })

  it('bounds selected candidates and AI eligibility and filters the requested year range', () => {
    const messages = [
      mail({ messageId: '<2023@example.test>', receivedAt: new Date('2023-06-01T00:00:00Z') }),
      mail({ messageId: '<2024-a@example.test>', receivedAt: new Date('2024-06-01T00:00:00Z') }),
      mail({ messageId: '<2024-b@example.test>', receivedAt: new Date('2024-07-01T00:00:00Z') }),
      mail({ messageId: '<2024-c@example.test>', receivedAt: new Date('2024-08-01T00:00:00Z') }),
    ]

    const result = collectRosterCandidates(messages, {
      fromYear: 2024,
      toYear: 2024,
      maxCandidates: 2,
      maxAiCalls: 1,
    })

    expect(result.candidateMessages).toBe(3)
    expect(result.selected).toHaveLength(2)
    expect(result.skippedByCandidateLimit).toBe(1)
    expect(result.aiEligible).toHaveLength(1)
  })

  it('rejects unlimited or negative cost limits', () => {
    expect(() => collectRosterCandidates([mail()], {
      maxCandidates: Number.POSITIVE_INFINITY,
      maxAiCalls: 0,
    })).toThrow(/maxCandidates/)
    expect(() => collectRosterCandidates([mail()], {
      maxCandidates: 1,
      maxAiCalls: -1,
    })).toThrow(/maxAiCalls/)
  })
})
