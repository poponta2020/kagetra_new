import { describe, it, expect } from 'vitest'
import {
  announcementSendAt,
  avoidSlotCollision,
  ceilToSlot,
  nextReminderDate,
  reminderSendAt,
  reminderTargetDates,
  splitTargets,
} from './schedule'

describe('ceilToSlot（10 分境界への切り上げ）', () => {
  it('境界上でなければ切り上げる', () => {
    expect(ceilToSlot(new Date('2026-03-01T11:03:00.000Z'))).toEqual(
      new Date('2026-03-01T11:10:00.000Z'),
    )
  })

  it('既に境界上ならそのまま', () => {
    expect(ceilToSlot(new Date('2026-03-01T11:00:00.000Z'))).toEqual(
      new Date('2026-03-01T11:00:00.000Z'),
    )
  })

  it('slotMinutes を指定できる', () => {
    expect(ceilToSlot(new Date('2026-03-01T11:01:00.000Z'), 5)).toEqual(
      new Date('2026-03-01T11:05:00.000Z'),
    )
  })
})

describe('announcementSendAt（案内の送信予定 = 現在 + 15分 を 10 分境界へ）', () => {
  it('15 分後が境界上でなければ切り上げる', () => {
    expect(announcementSendAt(new Date('2026-03-01T00:00:00.000Z'))).toEqual(
      new Date('2026-03-01T00:20:00.000Z'),
    )
  })

  it('15 分後がちょうど境界ならそのまま', () => {
    expect(announcementSendAt(new Date('2026-03-01T00:05:00.000Z'))).toEqual(
      new Date('2026-03-01T00:20:00.000Z'),
    )
  })
})

describe('reminderSendAt（リマインドの送信予定 = 対象日 20:00 JST + 10分×splitIndex）', () => {
  it('splitIndex=0 は 20:00 JST（=11:00 UTC）', () => {
    expect(reminderSendAt('2026-03-04', 0)).toEqual(new Date('2026-03-04T11:00:00.000Z'))
  })

  it('splitIndex=2 は 10 分 × 2 だけ後ろへずれる', () => {
    expect(reminderSendAt('2026-03-04', 2)).toEqual(new Date('2026-03-04T11:20:00.000Z'))
  })
})

describe('reminderTargetDates（対象日集合・AC-15）', () => {
  it('開始日+3n 日・締切前日・締切当日が重なると 1 件にまとまる（締切当日が +9 日と重なる）', () => {
    expect(reminderTargetDates('2026-03-01', '2026-03-10')).toEqual([
      '2026-03-04',
      '2026-03-07',
      '2026-03-09',
      '2026-03-10',
    ])
  })

  it('締切前日が +3n 日と重なる場合も 1 件にまとまる', () => {
    expect(reminderTargetDates('2026-03-01', '2026-03-08')).toEqual([
      '2026-03-04',
      '2026-03-07',
      '2026-03-08',
    ])
  })

  it('締切を過ぎる日（+3n 日が締切より後）は含めない', () => {
    expect(reminderTargetDates('2026-03-01', '2026-03-05')).toEqual([
      '2026-03-04',
      '2026-03-05',
    ])
  })

  it('開始日そのものは対象日に含めない（締切前日が開始日と一致するケース）', () => {
    expect(reminderTargetDates('2026-03-01', '2026-03-02')).toEqual(['2026-03-02'])
  })

  it('締切が開始日以前なら空配列', () => {
    expect(reminderTargetDates('2026-03-10', '2026-03-10')).toEqual([])
    expect(reminderTargetDates('2026-03-10', '2026-03-05')).toEqual([])
  })
})

describe('nextReminderDate（次のリマインド日）', () => {
  const dates = ['2026-03-04', '2026-03-07', '2026-03-08']

  it('今日以降で最も早い日を返す', () => {
    expect(nextReminderDate(dates, '2026-03-05')).toBe('2026-03-07')
  })

  it('今日がちょうど対象日ならその日を返す', () => {
    expect(nextReminderDate(dates, '2026-03-07')).toBe('2026-03-07')
  })

  it('全て過ぎていれば null', () => {
    expect(nextReminderDate(dates, '2026-03-09')).toBeNull()
  })
})

describe('avoidSlotCollision（同時刻の衝突回避）', () => {
  it('衝突が無ければそのまま', () => {
    const candidate = new Date('2026-03-04T11:00:00.000Z')
    expect(avoidSlotCollision(candidate, [])).toEqual(candidate)
  })

  it('衝突すれば 10 分後ろへずらす', () => {
    const candidate = new Date('2026-03-04T11:00:00.000Z')
    expect(avoidSlotCollision(candidate, [candidate])).toEqual(
      new Date('2026-03-04T11:10:00.000Z'),
    )
  })

  it('連続して衝突すれば空くまでずらし続ける', () => {
    const candidate = new Date('2026-03-04T11:00:00.000Z')
    const taken = [candidate, new Date('2026-03-04T11:10:00.000Z')]
    expect(avoidSlotCollision(candidate, taken)).toEqual(new Date('2026-03-04T11:20:00.000Z'))
  })
})

describe('splitTargets（分割・AC-16b）', () => {
  it('limit ごとに分割する', () => {
    const targets = Array.from({ length: 25 }, (_, i) => i + 1)
    const chunks = splitTargets(targets, 20)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(20)
    expect(chunks[1]).toHaveLength(5)
    // 重複なく合計が全対象と一致する。
    expect(chunks.flat()).toEqual(targets)
  })

  it('limit 以下なら 1 チャンク', () => {
    expect(splitTargets([1, 2, 3], 20)).toEqual([[1, 2, 3]])
  })

  it('空配列は空配列', () => {
    expect(splitTargets([], 20)).toEqual([])
  })
})
