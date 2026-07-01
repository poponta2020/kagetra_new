import { describe, expect, it } from 'vitest'
import {
  axisTicks,
  denseYears,
  formatCompact,
  formatDecimal1,
  formatInt,
  niceMax,
} from './chart-utils'

describe('formatInt / formatCompact / formatDecimal1', () => {
  it('formatInt は桁区切り整数', () => {
    expect(formatInt(0)).toBe('0')
    expect(formatInt(1234)).toBe('1,234')
    expect(formatInt(1234567)).toBe('1,234,567')
    expect(formatInt(12.6)).toBe('13') // 四捨五入
  })

  it('formatCompact は 1 万以上を「万」表記', () => {
    expect(formatCompact(999)).toBe('999')
    expect(formatCompact(9999)).toBe('9,999')
    expect(formatCompact(12000)).toBe('1.2万')
    expect(formatCompact(120000)).toBe('12万') // 10 万以上は整数万
  })

  it('formatDecimal1 は小数第1位', () => {
    expect(formatDecimal1(1.5)).toBe('1.5')
    expect(formatDecimal1(4)).toBe('4.0')
  })
})

describe('niceMax', () => {
  it('0/負は 1・きりの良い上端へ丸める', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-5)).toBe(1)
    expect(niceMax(3)).toBe(5)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(23)).toBe(25)
    expect(niceMax(120)).toBe(200)
  })
})

describe('axisTicks', () => {
  it('整数上端は割り切れる本数で整数目盛', () => {
    expect(axisTicks(5)).toEqual([0, 1, 2, 3, 4, 5]) // top=5 → 5等分
    expect(axisTicks(9)).toEqual([0, 2, 4, 6, 8, 10]) // top=10 → 5等分
    expect(axisTicks(2)).toEqual([0, 1, 2]) // top=2 → 2等分
  })

  it('最小値は 0、最大値は niceMax(top)', () => {
    const t = axisTicks(23)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBe(25)
  })
})

describe('denseYears', () => {
  it('min〜max を連続年で 0 埋め', () => {
    expect(
      denseYears([
        { year: 2018, count: 3 },
        { year: 2020, count: 5 },
      ]),
    ).toEqual([
      { label: '2018', value: 3 },
      { label: '2019', value: 0 },
      { label: '2020', value: 5 },
    ])
  })

  it('from/to を明示すると端まで 0 埋め（系列間の x 揃え）', () => {
    expect(denseYears([{ year: 2020, count: 4 }], 2019, 2021)).toEqual([
      { label: '2019', value: 0 },
      { label: '2020', value: 4 },
      { label: '2021', value: 0 },
    ])
  })

  it('空は空配列', () => {
    expect(denseYears([])).toEqual([])
  })
})
