import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import type { MailSearchRow } from '@/lib/member-mail/search'
import type { HistoryRow } from '@/lib/mail-history'

/**
 * member-mail-search タスク4: `loadMoreMails`（`/mail` の「もっと読み込む」用 Server
 * Action）。`searchMemberMails` / `loadHistories` をモックし、このファイル自身の配線
 * （認可・履歴サマリの合成）だけを見る。
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const searchMemberMailsMock = vi.fn()
vi.mock('@/lib/member-mail/search', () => ({
  searchMemberMails: (...args: unknown[]) => searchMemberMailsMock(...args),
}))

const loadHistoriesMock = vi.fn()
vi.mock('@/lib/mail-history.queries', () => ({
  loadHistories: (...args: unknown[]) => loadHistoriesMock(...args),
}))

vi.mock('@/lib/db', () => ({ db: {} }))

const { loadMoreMails } = await import('./actions')

function makeRow(overrides: Partial<MailSearchRow> = {}): MailSearchRow {
  return {
    id: 1,
    subject: '件名',
    fromName: null,
    fromAddress: 'test@example.jp',
    receivedAt: new Date('2026-08-08T07:25:00Z'),
    triageStatus: 'processed',
    mailKind: null,
    attachments: [],
    subjectMatched: false,
    excerpt: null,
    ...overrides,
  }
}

describe('loadMoreMails', () => {
  beforeEach(() => {
    searchMemberMailsMock.mockReset()
    loadHistoriesMock.mockReset()
  })

  it('未ログインで /auth/signin へ redirect する', async () => {
    await setAuthSession(null)

    await expect(loadMoreMails('', false, 20)).rejects.toThrow('NEXT_REDIRECT:/auth/signin')
    expect(searchMemberMailsMock).not.toHaveBeenCalled()
  })

  it('searchMemberMails と loadHistories の結果を合成して返す', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    const row1 = makeRow({ id: 1 })
    const row2 = makeRow({ id: 2 })
    searchMemberMailsMock.mockResolvedValue({ rows: [row1, row2], total: 2 })
    const historyRow: HistoryRow = {
      kind: 'dismissed',
      at: new Date('2026-08-03T00:00:00Z'),
      segments: [{ type: 'text', value: '対応不要として処理' }],
      detail: null,
      note: null,
      summarySegments: [{ type: 'text', value: '対応不要として処理' }],
    }
    const historyMap = new Map<number, HistoryRow[]>([[1, [historyRow]]])
    loadHistoriesMock.mockResolvedValue(historyMap)

    const result = await loadMoreMails('多摩', true, 20)

    expect(searchMemberMailsMock).toHaveBeenCalledWith({
      q: '多摩',
      attachmentsOnly: true,
      limit: 20,
      offset: 20,
    })
    expect(loadHistoriesMock).toHaveBeenCalledWith(expect.anything(), [1, 2])
    expect(result).toEqual([
      { row: row1, historySummary: historyRow },
      { row: row2, historySummary: null },
    ])
  })

  it('履歴が複数行あるメールは最新（配列末尾）を historySummary にする', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    const row = makeRow({ id: 5 })
    searchMemberMailsMock.mockResolvedValue({ rows: [row], total: 1 })
    const older: HistoryRow = {
      kind: 'draft_approved',
      at: new Date('2026-08-01T00:00:00Z'),
      segments: [{ type: 'text', value: '案内として処理' }],
      detail: null,
      note: null,
      summarySegments: [{ type: 'text', value: '案内として処理' }],
    }
    const newer: HistoryRow = {
      kind: 'broadcast',
      at: new Date('2026-08-02T00:00:00Z'),
      segments: [{ type: 'text', value: 'LINEグループへ配信' }],
      detail: '（本文のみ）',
      note: null,
      summarySegments: [{ type: 'text', value: 'LINE配信' }],
    }
    loadHistoriesMock.mockResolvedValue(new Map([[5, [older, newer]]]))

    const result = await loadMoreMails('', false, 0)

    expect(result).toEqual([{ row, historySummary: newer }])
  })
})
