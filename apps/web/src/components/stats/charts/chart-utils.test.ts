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
  it('0/負は 1・きりの良いステップの整数倍へ切り上げ', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-5)).toBe(1)
    expect(niceMax(3)).toBe(3)
    expect(niceMax(7)).toBe(8)
    expect(niceMax(23)).toBe(25)
    expect(niceMax(120)).toBe(150)
  })

  it('integer=true は小さい件数でも整数上端を返す', () => {
    expect(niceMax(1, true)).toBe(1)
    expect(niceMax(2, true)).toBe(2)
  })
})

describe('axisTicks', () => {
  it('きりの良いステップで 0 から刻む', () => {
    expect(axisTicks(5)).toEqual([0, 1, 2, 3, 4, 5])
    expect(axisTicks(9)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('integer=true は件数軸で整数目盛（小数・重複を出さない）', () => {
    // 旧実装は上端=1 を 4 等分し 0/0.25/0.5/0.75/1 → 丸めで「0,0,1,1,1」と重複していた。
    expect(axisTicks(1, true)).toEqual([0, 1])
    expect(axisTicks(2, true)).toEqual([0, 1, 2])
    expect(axisTicks(23, true)).toEqual([0, 5, 10, 15, 20, 25])
    expect(axisTicks(120, true).every((t) => Number.isInteger(t))).toBe(true)
  })

  it('小数軸（integer=false）は 0.5 刻みなど割り切れる小数目盛', () => {
    // 旧実装は上端=2.5 を 4 等分し 0.625 刻みの半端目盛になっていた。
    expect(axisTicks(2.3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
  })

  it('最小値は 0、最大値は上端', () => {
    const t = axisTicks(23)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBe(25)
  })

  it('0/負でも空にならない', () => {
    expect(axisTicks(0)).toEqual([0, 1])
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
