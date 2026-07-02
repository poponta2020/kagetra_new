import { describe, it, expect } from 'vitest'
import type { Grade } from '@kagetra/shared/types'
import {
  formatEventDate,
  formatDeadlineCountdown,
  isGradeEligible,
  sortEvents,
} from './event-list-utils'

describe('formatEventDate', () => {
  it('formats as M/D(曜) without zero-padding (requirement example)', () => {
    // 2026-07-12 is a Sunday.
    expect(formatEventDate('2026-07-12')).toBe('7/12(日)')
  })

  it('drops leading zeros on both month and day', () => {
    // 2026-01-05 is a Monday.
    expect(formatEventDate('2026-01-05')).toBe('1/5(月)')
  })

  it('computes Saturday (weekday index 6)', () => {
    // 2026-07-11 is a Saturday.
    expect(formatEventDate('2026-07-11')).toBe('7/11(土)')
  })

  it('returns the input unchanged when not a YYYY-MM-DD string', () => {
    expect(formatEventDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatDeadlineCountdown', () => {
  const today = '2026-07-10'

  it('null deadline → dash / none', () => {
    expect(formatDeadlineCountdown(null, today)).toEqual({ text: '—', tone: 'none' })
  })

  it('same day (daysLeft 0) → 本日 / today', () => {
    expect(formatDeadlineCountdown('2026-07-10', today)).toEqual({
      text: '本日',
      tone: 'today',
    })
  })

  it('1 day left → soon', () => {
    expect(formatDeadlineCountdown('2026-07-11', today)).toEqual({
      text: 'あと1日',
      tone: 'soon',
    })
  })

  it('3 days left → soon (upper boundary of soon)', () => {
    expect(formatDeadlineCountdown('2026-07-13', today)).toEqual({
      text: 'あと3日',
      tone: 'soon',
    })
  })

  it('4 days left → normal (3↔4 boundary)', () => {
    expect(formatDeadlineCountdown('2026-07-14', today)).toEqual({
      text: 'あと4日',
      tone: 'normal',
    })
  })

  it('past deadline (daysLeft < 0) → 締切済 / past', () => {
    expect(formatDeadlineCountdown('2026-07-09', today)).toEqual({
      text: '締切済',
      tone: 'past',
    })
  })

  it('crosses a month boundary correctly', () => {
    // 2026-07-31 → 2026-08-02 is 2 days.
    expect(formatDeadlineCountdown('2026-08-02', '2026-07-31')).toEqual({
      text: 'あと2日',
      tone: 'soon',
    })
  })

  it('malformed deadline → dash / none (defensive)', () => {
    expect(formatDeadlineCountdown('garbage', today)).toEqual({
      text: '—',
      tone: 'none',
    })
  })
})

describe('isGradeEligible', () => {
  it('null eligibleGrades → eligible (対象級未設定=全級)', () => {
    expect(isGradeEligible(null, 'C')).toBe(true)
  })

  it('empty eligibleGrades → eligible', () => {
    expect(isGradeEligible([], 'C')).toBe(true)
  })

  it('grade included → eligible', () => {
    expect(isGradeEligible(['A', 'B'], 'B')).toBe(true)
  })

  it('grade not included → not eligible', () => {
    expect(isGradeEligible(['A', 'B'], 'C')).toBe(false)
  })

  it('grade=null with eligibleGrades set → not eligible', () => {
    expect(isGradeEligible(['A', 'B'], null)).toBe(false)
  })

  it('grade=null with no eligibleGrades → eligible', () => {
    expect(isGradeEligible(null, null)).toBe(true)
  })

  it('undefined eligibleGrades → eligible', () => {
    expect(isGradeEligible(undefined, 'C')).toBe(true)
  })
})

type Row = { id: number; eventDate: string; internalDeadline: string | null }
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('sortEvents', () => {
  const rows: Row[] = [
    { id: 1, eventDate: '2026-08-01', internalDeadline: '2026-07-20' },
    { id: 2, eventDate: '2026-07-15', internalDeadline: null },
    { id: 3, eventDate: '2026-07-10', internalDeadline: '2026-07-05' },
    { id: 4, eventDate: '2026-07-25', internalDeadline: null },
  ]

  it('date axis → eventDate ascending', () => {
    expect(ids(sortEvents(rows, 'date'))).toEqual([3, 2, 4, 1])
  })

  it('deadline axis → deadline ascending, nulls last (eventDate secondary within nulls)', () => {
    expect(ids(sortEvents(rows, 'deadline'))).toEqual([3, 1, 2, 4])
  })

  it('deadline axis → ties on deadline broken by eventDate ascending', () => {
    const tied: Row[] = [
      { id: 10, eventDate: '2026-09-02', internalDeadline: '2026-07-05' },
      { id: 11, eventDate: '2026-09-01', internalDeadline: '2026-07-05' },
    ]
    expect(ids(sortEvents(tied, 'deadline'))).toEqual([11, 10])
  })

  it('does not mutate the input array', () => {
    const before = ids(rows)
    sortEvents(rows, 'deadline')
    expect(ids(rows)).toEqual(before)
  })
})

// Type-level guard: eligibleGrades accepts Grade[] shape.
const _grades: Grade[] = ['A', 'E']
void _grades
