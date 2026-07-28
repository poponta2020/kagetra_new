import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      tournamentEntryRosterFiles: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}))

const { loadAdoptedRosterFile, parseCanonicalRosterFileId } = await import(
  './roster-file-access'
)

describe('loadAdoptedRosterFile', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
  })

  it('returns null when no adoption row exists (未採用・解除済み・CASCADE削除いずれも同じ扱い)', async () => {
    mockFindFirst.mockResolvedValue(undefined)
    const result = await loadAdoptedRosterFile(1)
    expect(result).toBeNull()
  })

  it('returns null when the joined attachment is missing (defensive fail-closed)', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      rosterType: 'confirmed',
      publishedAt: null,
      sourceAttachment: undefined,
    })
    const result = await loadAdoptedRosterFile(1)
    expect(result).toBeNull()
  })

  it('returns only the member-safe fields when adopted', async () => {
    mockFindFirst.mockResolvedValue({
      id: 5,
      rosterType: 'confirmed',
      publishedAt: '2026-08-01',
      sourceAttachment: {
        id: 42,
        filename: '確定名簿.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
    const result = await loadAdoptedRosterFile(5)
    expect(result).toEqual({
      id: 5,
      rosterType: 'confirmed',
      publishedAt: '2026-08-01',
      attachment: {
        id: 42,
        filename: '確定名簿.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
    // 内部情報 (sourceMailMessageId / adoptedByUserId / note) が返り値に
    // 一切含まれないことをキー集合で固定する。「必要なキーがある」だけの
    // アサートでは漏洩を検出できない。
    expect(Object.keys(result ?? {})).toEqual([
      'id',
      'rosterType',
      'publishedAt',
      'attachment',
    ])
    expect(Object.keys(result?.attachment ?? {})).toEqual([
      'id',
      'filename',
      'contentType',
    ])
    expect(result).not.toHaveProperty('note')
    expect(result).not.toHaveProperty('sourceMailMessageId')
    expect(result).not.toHaveProperty('adoptedByUserId')
  })

  it('never selects internal columns from the DB in the first place', async () => {
    // 「返り値に無い」だけでなく「そもそも select していない」ことを固定する。
    // findFirst の呼び出し引数（columns 指定）そのものを検査する。
    mockFindFirst.mockResolvedValue({
      id: 1,
      rosterType: 'applicant',
      publishedAt: null,
      sourceAttachment: {
        id: 1,
        filename: 'a.pdf',
        contentType: 'application/pdf',
      },
    })
    await loadAdoptedRosterFile(1)
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    const call = mockFindFirst.mock.calls[0]?.[0] as {
      columns?: Record<string, boolean>
      with?: { sourceAttachment?: { columns?: Record<string, boolean> } }
    }
    expect(call.columns).toEqual({
      id: true,
      rosterType: true,
      publishedAt: true,
    })
    expect(call.with?.sourceAttachment?.columns).toEqual({
      id: true,
      filename: true,
      contentType: true,
    })
  })
})

describe('parseCanonicalRosterFileId', () => {
  it('accepts canonical positive integer strings', () => {
    expect(parseCanonicalRosterFileId('1')).toBe(1)
    expect(parseCanonicalRosterFileId('42')).toBe(42)
  })

  it.each(['abc', '0', '01', '1.5', '1e5', '-1', ' 1', '1 ', ''])(
    'rejects non-canonical id %p',
    (bad) => {
      expect(parseCanonicalRosterFileId(bad)).toBeNull()
    },
  )

  it('rejects ids beyond int4 max', () => {
    expect(
      parseCanonicalRosterFileId('999999999999999999999'),
    ).toBeNull()
  })
})
