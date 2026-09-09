import { describe, it, expect } from 'vitest'
import { formatDanKanji } from './dan-kanji'

describe('formatDanKanji（段位の漢数字表記）', () => {
  it('1〜9段が漢数字表記になる', () => {
    expect(formatDanKanji(1)).toBe('初段')
    expect(formatDanKanji(2)).toBe('弐段')
    expect(formatDanKanji(3)).toBe('参段')
    expect(formatDanKanji(4)).toBe('四段')
    expect(formatDanKanji(5)).toBe('五段')
    expect(formatDanKanji(6)).toBe('六段')
    expect(formatDanKanji(7)).toBe('七段')
    expect(formatDanKanji(8)).toBe('八段')
    expect(formatDanKanji(9)).toBe('九段')
  })

  it('0 と null/undefined は無段扱いで null', () => {
    expect(formatDanKanji(0)).toBeNull()
    expect(formatDanKanji(null)).toBeNull()
    expect(formatDanKanji(undefined)).toBeNull()
  })

  it('範囲外の値は null（名簿の列としては空欄扱い）', () => {
    expect(formatDanKanji(10)).toBeNull()
    expect(formatDanKanji(-1)).toBeNull()
  })
})
