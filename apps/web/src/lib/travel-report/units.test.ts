import { describe, it, expect } from 'vitest'
import {
  addDays,
  buildTravelUnits,
  diffDays,
  findTravelUnit,
  findUnitContainingDate,
  findUnitContainingEvent,
  inclusiveDayCount,
} from './units'

const ev = (id: number, eventDate: string, status: 'published' | 'cancelled' | 'done' = 'published') => ({
  id,
  eventDate,
  status,
})

describe('日付ユーティリティ', () => {
  it('加算・差分は UTC で行い、JST でも日付がずれない', () => {
    expect(addDays('2026-06-13', 1)).toBe('2026-06-14')
    expect(addDays('2026-06-13', -1)).toBe('2026-06-12')
    // 月またぎ・年またぎ・閏日。
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(diffDays('2026-06-13', '2026-06-15')).toBe(2)
    expect(diffDays('2026-06-15', '2026-06-13')).toBe(-2)
  })

  it('暦日数は自至を含む（届の「（N日間）」）', () => {
    expect(inclusiveDayCount('2026-06-13', '2026-06-13')).toBe(1)
    expect(inclusiveDayCount('2026-06-13', '2026-06-14')).toBe(2)
    expect(inclusiveDayCount('2026-11-06', '2026-11-09')).toBe(4)
  })
})

describe('遠征単位の導出（R4）', () => {
  it('連続する日は1単位、飛んだ日は別単位になる', () => {
    // 第1土日（6/13,14）と第2土日（6/20,21）＝2単位。
    const units = buildTravelUnits([
      ev(1, '2026-06-13'),
      ev(2, '2026-06-14'),
      ev(3, '2026-06-20'),
      ev(4, '2026-06-21'),
    ])
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({
      startDate: '2026-06-13',
      endDate: '2026-06-14',
      dates: ['2026-06-13', '2026-06-14'],
      eventIds: [1, 2],
    })
    expect(units[1]).toMatchObject({
      startDate: '2026-06-20',
      endDate: '2026-06-21',
      eventIds: [3, 4],
    })
  })

  it('cancelled の日は単位に入らない（間が cancelled ならブロックが割れる）', () => {
    const units = buildTravelUnits([
      ev(1, '2026-06-13'),
      ev(2, '2026-06-14', 'cancelled'),
      ev(3, '2026-06-15'),
    ])
    expect(units.map((u) => u.startDate)).toEqual(['2026-06-13', '2026-06-15'])
    expect(units[0]!.dates).toEqual(['2026-06-13'])
    expect(units[1]!.dates).toEqual(['2026-06-15'])
  })

  it('done は開催済みなので単位に含める', () => {
    const units = buildTravelUnits([ev(1, '2026-06-13', 'done'), ev(2, '2026-06-14', 'done')])
    expect(units).toHaveLength(1)
    expect(units[0]!.dates).toHaveLength(2)
  })

  it('同じ日に複数の級（複数 events）があっても 1 日として扱う', () => {
    const units = buildTravelUnits([
      ev(10, '2026-06-13'), // A/B級
      ev(11, '2026-06-13'), // C/D/E級
      ev(12, '2026-06-14'),
    ])
    expect(units).toHaveLength(1)
    expect(units[0]!.dates).toEqual(['2026-06-13', '2026-06-14'])
    expect(units[0]!.eventIds).toEqual([10, 11, 12])
  })

  it('入力順が乱れていても日付昇順・id 昇順で整う', () => {
    const units = buildTravelUnits([ev(5, '2026-06-14'), ev(3, '2026-06-13'), ev(2, '2026-06-13')])
    expect(units).toHaveLength(1)
    expect(units[0]!.dates).toEqual(['2026-06-13', '2026-06-14'])
    expect(units[0]!.eventIds).toEqual([2, 3, 5])
  })

  it('月・年をまたぐ連続日も1単位になる', () => {
    const units = buildTravelUnits([ev(1, '2026-12-31'), ev(2, '2027-01-01')])
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ startDate: '2026-12-31', endDate: '2027-01-01' })
  })

  it('開催日が無い・全部 cancelled なら単位ゼロ', () => {
    expect(buildTravelUnits([])).toEqual([])
    expect(buildTravelUnits([ev(1, '2026-06-13', 'cancelled')])).toEqual([])
  })

  it('キーはブロック初日で、開催日が増えて前へ伸びるとキーが変わる（孤児化は想定内）', () => {
    const before = buildTravelUnits([ev(1, '2026-06-13'), ev(2, '2026-06-14')])
    const after = buildTravelUnits([ev(3, '2026-06-12'), ev(1, '2026-06-13'), ev(2, '2026-06-14')])
    expect(before[0]!.startDate).toBe('2026-06-13')
    expect(after[0]!.startDate).toBe('2026-06-12')
    // 旧キーの経路・通知記録は読まれなくなるだけ（再キー付けしない）。
    expect(findTravelUnit(after, '2026-06-13')).toBeNull()
  })
})

describe('単位の引き当て', () => {
  const units = buildTravelUnits([
    ev(1, '2026-06-13'),
    ev(2, '2026-06-14'),
    ev(3, '2026-06-20'),
  ])

  it('キー・日付・イベントから引ける', () => {
    expect(findTravelUnit(units, '2026-06-13')?.endDate).toBe('2026-06-14')
    expect(findUnitContainingDate(units, '2026-06-14')?.startDate).toBe('2026-06-13')
    expect(findUnitContainingEvent(units, 3)?.startDate).toBe('2026-06-20')
  })

  it('見つからなければ null', () => {
    expect(findTravelUnit(units, '2026-06-14')).toBeNull() // 初日ではない
    expect(findUnitContainingDate(units, '2026-06-15')).toBeNull()
    expect(findUnitContainingEvent(units, 999)).toBeNull()
  })
})
