import { describe, it, expect } from 'vitest'
import { formatEventDateRange, formatReceivedDate, formatDanDisplay, tallyGrades } from './entry-form-format'

describe('formatEventDateRange', () => {
  it('日程未定（空配列）', () => {
    expect(formatEventDateRange([])).toBe('日程未定')
  })

  it('単日は M/D', () => {
    expect(formatEventDateRange(['2026-06-13'])).toBe('6/13')
  })

  it('同月内の複数日は M/D〜D（b-step1.html: 6/13〜14）', () => {
    expect(formatEventDateRange(['2026-06-13', '2026-06-14'])).toBe('6/13〜14')
  })

  it('月をまたぐ場合は M/D〜M/D', () => {
    expect(formatEventDateRange(['2026-06-30', '2026-07-01'])).toBe('6/30〜7/1')
  })
})

describe('formatReceivedDate', () => {
  it('ISO 日時から M/D（JST）を返す', () => {
    // 2026-05-08T00:30:00Z は JST で 5/8 09:30
    expect(formatReceivedDate('2026-05-08T00:30:00Z')).toBe('5/8')
  })

  it('JST への変換で日付が繰り上がるケース', () => {
    // 2026-05-07T15:30:00Z は JST で 5/8 00:30
    expect(formatReceivedDate('2026-05-07T15:30:00Z')).toBe('5/8')
  })
})

describe('formatDanDisplay', () => {
  it('null は無段', () => {
    expect(formatDanDisplay(null)).toBe('無段')
  })
  it('0 は無段', () => {
    expect(formatDanDisplay(0)).toBe('無段')
  })
  it('1〜10 は n段 表記', () => {
    expect(formatDanDisplay(1)).toBe('初段')
    expect(formatDanDisplay(4)).toBe('4段')
    expect(formatDanDisplay(10)).toBe('10段')
  })
  it('範囲外はそのまま n段', () => {
    expect(formatDanDisplay(11)).toBe('11段')
  })
})

describe('tallyGrades', () => {
  it('級別人数と計を返す（b-step2.html: A5/B5/C3/D1/E1・計15）', () => {
    const grades = [
      'A', 'A', 'A', 'A', 'A',
      'B', 'B', 'B', 'B', 'B',
      'C', 'C', 'C',
      'D',
      'E',
    ] as const
    expect(tallyGrades(grades)).toEqual({
      byGrade: [
        { grade: 'A', count: 5 },
        { grade: 'B', count: 5 },
        { grade: 'C', count: 3 },
        { grade: 'D', count: 1 },
        { grade: 'E', count: 1 },
      ],
      total: 15,
    })
  })

  it('級未設定は集計行に出さないが計には数える', () => {
    expect(tallyGrades(['A', null, null])).toEqual({
      byGrade: [{ grade: 'A', count: 1 }],
      total: 3,
    })
  })
})
