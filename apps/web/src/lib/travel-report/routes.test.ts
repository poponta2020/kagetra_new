import { describe, it, expect } from 'vitest'
import type { TravelLeg } from '@kagetra/shared'
import {
  applyWayChange,
  buildAttendanceRows,
  buildDefaultLegs,
  buildDefaultOutboundLeg,
  buildDefaultReturnLeg,
  normalizeRouteInput,
  sortLegs,
  travelRouteInputSchema,
  validateLegDates,
  LEGS_MAX_ROWS,
  PLACE_MAX_LENGTH,
} from './routes'

const base = {
  departureKind: 'sapporo' as const,
  departurePlace: null,
  returnKind: 'sapporo' as const,
  returnPlace: null,
  // 単位は 6/13-6/14 だが、本人は 6/14 だけ出場する（既定行の基準を確かめるため）。
  attendanceDates: ['2026-06-14'],
  destinationLabel: '青森',
}

describe('既定の行程は本人の出場日基準（R6・AC-13）', () => {
  it('札幌から／札幌へ戻る = 最初の出場日の前日と最後の出場日の翌日', () => {
    const legs = buildDefaultLegs({ ...base, attendanceDates: ['2026-06-13', '2026-06-14'] })
    expect(legs).toEqual([
      { date: '2026-06-12', from: '札幌', to: '青森' },
      { date: '2026-06-15', from: '青森', to: '札幌' },
    ])
  })

  it('★単位の初日／最終日ではなく本人の出場日を基準にする', () => {
    // 単位が 6/13-6/14 でも、本人が 6/14 だけ出るなら 6/13 発・6/15 帰り。
    const legs = buildDefaultLegs(base)
    expect(legs).toEqual([
      { date: '2026-06-13', from: '札幌', to: '青森' },
      { date: '2026-06-15', from: '青森', to: '札幌' },
    ])
  })

  it('帰省先から出場 で往路の既定行が消える（AC-14）', () => {
    expect(buildDefaultOutboundLeg({ ...base, departureKind: 'hometown' })).toBeNull()
    // 帰りは残る。
    expect(buildDefaultReturnLeg({ ...base, departureKind: 'hometown' })).not.toBeNull()
  })

  it('そのまま帰省 で復路の既定行が消える（AC-14）', () => {
    expect(buildDefaultReturnLeg({ ...base, returnKind: 'hometown' })).toBeNull()
  })

  it('その他 は入力した地名で既定行が作られる（AC-14）', () => {
    const legs = buildDefaultLegs({
      ...base,
      departureKind: 'other',
      departurePlace: '仙台',
      returnKind: 'other',
      returnPlace: '東京',
    })
    expect(legs).toEqual([
      { date: '2026-06-13', from: '仙台', to: '青森' },
      { date: '2026-06-15', from: '青森', to: '東京' },
    ])
  })

  it('開催地が未設定なら該当欄が空欄になる（R6）', () => {
    const legs = buildDefaultLegs({ ...base, destinationLabel: null })
    expect(legs).toEqual([
      { date: '2026-06-13', from: '札幌', to: '' },
      { date: '2026-06-15', from: '', to: '札幌' },
    ])
  })

  it('出場日が無ければ既定行は作らない', () => {
    expect(buildDefaultLegs({ ...base, attendanceDates: [] })).toEqual([])
  })
})

describe('選択を変えると既定行だけが差し替わる（R6）', () => {
  const own: TravelLeg = { date: '2026-06-14', from: '青森', to: '八戸' }

  it('本人が足した行は残る', () => {
    const prev = buildDefaultLegs(base)
    const legs = sortLegs([...prev, own])
    const next = buildDefaultLegs({ ...base, returnKind: 'hometown' })
    const result = applyWayChange(legs, prev, next)
    expect(result).toEqual([{ date: '2026-06-13', from: '札幌', to: '青森' }, own])
  })

  it('既定行を手で書き換えていたら「本人の行」として残る', () => {
    const prev = buildDefaultLegs(base)
    // 往路の出発地を「小樽」に直した状態。
    const edited: TravelLeg = { date: '2026-06-13', from: '小樽', to: '青森' }
    const legs = [edited, prev[1]!]
    const next = buildDefaultLegs({ ...base, departureKind: 'hometown' })
    const result = applyWayChange(legs, prev, next)
    expect(result).toContainEqual(edited)
  })

  it('同じ選択を選び直しても既定行は重複しない', () => {
    const prev = buildDefaultLegs(base)
    const result = applyWayChange(prev, prev, buildDefaultLegs(base))
    expect(result).toEqual(prev)
  })

  it('差し替え後は日付昇順に整う', () => {
    const prev = buildDefaultLegs({ ...base, departureKind: 'hometown' })
    const legs = [own, ...prev]
    const next = buildDefaultLegs(base)
    const result = applyWayChange(legs, prev, next)
    expect(result.map((l) => l.date)).toEqual(['2026-06-13', '2026-06-14', '2026-06-15'])
  })
})

describe('大会出場の行（保存せず導出）', () => {
  it('通常は「大会出場」', () => {
    expect(buildAttendanceRows(['2026-06-14', '2026-06-13'], 'sapporo')).toEqual([
      { date: '2026-06-13', label: '大会出場' },
      { date: '2026-06-14', label: '大会出場' },
    ])
  })

  it('帰省先から出場 のときだけ表記が変わる（その他では変えない）', () => {
    expect(buildAttendanceRows(['2026-06-13'], 'hometown')[0]!.label).toBe('大会出場（帰省先から出場）')
    expect(buildAttendanceRows(['2026-06-13'], 'other')[0]!.label).toBe('大会出場')
  })
})

describe('入力検証（Server Action 境界）', () => {
  const ok = {
    departureKind: 'sapporo' as const,
    returnKind: 'sapporo' as const,
    legs: [{ date: '2026-06-13', from: '札幌', to: '青森' }],
  }

  it('正常な入力は通る（移動0行でも可）', () => {
    expect(travelRouteInputSchema.safeParse(ok).success).toBe(true)
    expect(travelRouteInputSchema.safeParse({ ...ok, legs: [] }).success).toBe(true)
  })

  it('その他 で地名が空なら拒否する（AC-14）', () => {
    const r = travelRouteInputSchema.safeParse({ ...ok, departureKind: 'other', departurePlace: '' })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('行きの地名')
    const r2 = travelRouteInputSchema.safeParse({ ...ok, returnKind: 'other', returnPlace: null })
    expect(r2.success).toBe(false)
    expect(JSON.stringify(r2.error?.issues)).toContain('帰りの地名')
  })

  it('地名の長さ・行数・日付形式の上限を守る', () => {
    const long = 'あ'.repeat(PLACE_MAX_LENGTH + 1)
    expect(travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2026-06-13', from: long, to: '青森' }] }).success).toBe(false)
    expect(travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2026-06-13', from: '', to: '青森' }] }).success).toBe(false)
    const many = Array.from({ length: LEGS_MAX_ROWS + 1 }, () => ({ date: '2026-06-13', from: 'a', to: 'b' }))
    expect(travelRouteInputSchema.safeParse({ ...ok, legs: many }).success).toBe(false)
    expect(travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2026/06/13', from: 'a', to: 'b' }] }).success).toBe(false)
  })

  it('単位の前後 ±14 日を超える日付を拒否する', () => {
    const unit = { startDate: '2026-06-13', endDate: '2026-06-14' }
    expect(validateLegDates([{ date: '2026-05-30', from: 'a', to: 'b' }], unit)).toBeNull()
    expect(validateLegDates([{ date: '2026-05-29', from: 'a', to: 'b' }], unit)).toContain('14日前')
    expect(validateLegDates([{ date: '2026-06-28', from: 'a', to: 'b' }], unit)).toBeNull()
    expect(validateLegDates([{ date: '2026-06-29', from: 'a', to: 'b' }], unit)).toContain('14日後')
  })

  it('実在しない日付は形式が合っていても拒否する（Codex R1 #3）', () => {
    expect(
      travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2026-02-31', from: 'a', to: 'b' }] })
        .success,
    ).toBe(false)
    expect(
      travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2026-13-01', from: 'a', to: 'b' }] })
        .success,
    ).toBe(false)
    // うるう年の 2/29 は通る。
    expect(
      travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2028-02-29', from: 'a', to: 'b' }] })
        .success,
    ).toBe(true)
    // うるう年でない年の 2/29 は弾く。
    expect(
      travelRouteInputSchema.safeParse({ ...ok, legs: [{ date: '2027-02-29', from: 'a', to: 'b' }] })
        .success,
    ).toBe(false)
  })

  it('validateLegDates も実在しない日付を範囲外として弾く（二重の網。Codex R1 #3）', () => {
    const unit = { startDate: '2026-06-13', endDate: '2026-06-14' }
    expect(validateLegDates([{ date: '2026-02-31', from: 'a', to: 'b' }], unit)).not.toBeNull()
    expect(validateLegDates([{ date: '2027-02-29', from: 'a', to: 'b' }], unit)).not.toBeNull()
  })

  it('正規化で その他 以外の地名を捨て、日付順に整える', () => {
    const parsed = travelRouteInputSchema.parse({
      departureKind: 'sapporo',
      departurePlace: '仙台', // 選択が sapporo なので捨てられる
      returnKind: 'other',
      returnPlace: '東京',
      legs: [
        { date: '2026-06-15', from: ' 青森 ', to: ' 東京 ' },
        { date: '2026-06-13', from: '札幌', to: '青森' },
      ],
    })
    const n = normalizeRouteInput(parsed)
    expect(n.departurePlace).toBeNull()
    expect(n.returnPlace).toBe('東京')
    expect(n.legs).toEqual([
      { date: '2026-06-13', from: '札幌', to: '青森' },
      { date: '2026-06-15', from: '青森', to: '東京' },
    ])
  })
})
