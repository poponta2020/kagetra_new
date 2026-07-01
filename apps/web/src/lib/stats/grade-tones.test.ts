import { describe, expect, it } from 'vitest'
import {
  ALL_SERIES_TONE,
  GRADE_TONES,
  GRADE_TONE_ENTRIES,
  gradeTone,
  seriesLabel,
} from './grade-tones'

const ACCENT = '#b33c2d' // 朱（accent）

describe('GRADE_TONES', () => {
  it('A〜E の 5 トーン・A は藍（brand）', () => {
    expect(Object.keys(GRADE_TONES)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(GRADE_TONES.A).toBe('#2b4e8c')
  })

  it('朱（accent）をデータ装飾トーンに使わない（design-spec §8）', () => {
    for (const tone of Object.values(GRADE_TONES)) {
      expect(tone.toLowerCase()).not.toBe(ACCENT)
    }
    expect(ALL_SERIES_TONE.toLowerCase()).not.toBe(ACCENT)
  })

  it('GRADE_TONE_ENTRIES は [grade, tone] 5 件', () => {
    expect(GRADE_TONE_ENTRIES).toHaveLength(5)
    expect(GRADE_TONE_ENTRIES[0]).toEqual(['A', '#2b4e8c'])
  })
})

describe('gradeTone / seriesLabel', () => {
  it('all は全級トーン・A〜E は級トーン', () => {
    expect(gradeTone('all')).toBe(ALL_SERIES_TONE)
    expect(gradeTone('C')).toBe(GRADE_TONES.C)
  })

  it('seriesLabel は 全級 / N級', () => {
    expect(seriesLabel('all')).toBe('全級')
    expect(seriesLabel('B')).toBe('B級')
  })
})
