import { describe, expect, it } from 'vitest'
import { parseRosterGrid } from '../../src/roster-import/parser.js'

describe('mail-worker roster parser', () => {
  it('combines every name-bearing sheet and preserves grade/outcome', () => {
    const parsed = parseRosterGrid([
      { name: '表紙', grid: [['第40回大会'], ['注意事項']] },
      {
        name: 'A級当選',
        grid: [['氏名', '所属', '抽選除外'], ['札幌 太郎', '札幌会', '○']],
      },
      {
        name: 'A級キャンセル待ち',
        grid: [['氏名', '所属'], ['函館花子', '函館会']],
      },
      {
        name: 'B級',
        grid: [['氏名', '当落'], ['小樽次郎', '落選']],
      },
    ])

    expect(parsed.sheetNames).toEqual(['A級当選', 'A級キャンセル待ち', 'B級'])
    expect(parsed.entries).toEqual([
      expect.objectContaining({
        rawName: '札幌 太郎',
        grade: 'A',
        selectionOutcome: 'accepted',
        selectionExempt: true,
      }),
      expect.objectContaining({
        rawName: '函館花子',
        grade: 'A',
        selectionOutcome: 'waitlisted',
      }),
      expect.objectContaining({
        rawName: '小樽次郎',
        grade: 'B',
        selectionOutcome: 'rejected',
      }),
    ])
  })

  it('keeps normalized duplicates and reports a structured validation issue', () => {
    const parsed = parseRosterGrid([
      { name: 'A級当選', grid: [['氏名'], ['札幌 太郎']] },
      { name: 'A級待機', grid: [['氏名'], ['札幌太郎']] },
    ])

    expect(parsed.entries.map((entry) => entry.rawName)).toEqual(['札幌 太郎', '札幌太郎'])
    expect(parsed.validationIssues).toEqual([
      {
        code: 'duplicate_name_grade',
        message: expect.stringMatching(/同一級に重複/),
        sheetNames: ['A級当選', 'A級待機'],
      },
    ])
  })
})
