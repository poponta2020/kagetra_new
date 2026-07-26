import { describe, it, expect } from 'vitest'
import {
  formatEventDate,
  formatFlowDate,
  formatDateTimeFull,
  formatDateTimeShort,
} from './event-date'

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

describe('formatFlowDate', () => {
  it('formats as M/D without weekday or zero-padding', () => {
    expect(formatFlowDate('2026-07-12')).toBe('7/12')
  })

  it('drops leading zeros on both month and day', () => {
    expect(formatFlowDate('2026-01-05')).toBe('1/5')
  })

  it('null → 未定', () => {
    expect(formatFlowDate(null)).toBe('未定')
  })

  it('undefined → 未定', () => {
    expect(formatFlowDate(undefined)).toBe('未定')
  })

  it('returns the input unchanged when not a YYYY-MM-DD string (defensive)', () => {
    expect(formatFlowDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatDateTimeFull', () => {
  it('formats as YYYY/MM/DD HH:mm in JST regardless of the value being UTC', () => {
    // 05:32 UTC = 14:32 JST, same calendar day.
    expect(formatDateTimeFull(new Date('2026-07-20T05:32:00Z'))).toBe('2026/07/20 14:32')
  })

  it('zero-pads month, day, hour and minute', () => {
    // 15:05 UTC = 00:05 JST the next day (2026-01-06).
    expect(formatDateTimeFull(new Date('2026-01-05T15:05:00Z'))).toBe('2026/01/06 00:05')
  })

  it('accepts an ISO string with an explicit offset', () => {
    expect(formatDateTimeFull('2026-07-20T14:32:00+09:00')).toBe('2026/07/20 14:32')
  })

  it('null → —', () => {
    expect(formatDateTimeFull(null)).toBe('—')
  })

  it('undefined → —', () => {
    expect(formatDateTimeFull(undefined)).toBe('—')
  })

  it('invalid date string → —', () => {
    expect(formatDateTimeFull('not-a-date')).toBe('—')
  })
})

describe('formatDateTimeShort', () => {
  it('formats as M/D HH:mm in JST, no year, no zero-padding on month/day', () => {
    // 09:02 UTC = 18:02 JST, same calendar day.
    expect(formatDateTimeShort(new Date('2026-07-25T09:02:00Z'))).toBe('7/25 18:02')
  })

  it('zero-pads hour and minute but not month/day', () => {
    // 15:05 UTC = 00:05 JST the next day (2026-01-06).
    expect(formatDateTimeShort(new Date('2026-01-05T15:05:00Z'))).toBe('1/6 00:05')
  })

  it('accepts an ISO string with an explicit offset', () => {
    expect(formatDateTimeShort('2026-07-25T18:02:00+09:00')).toBe('7/25 18:02')
  })

  it('null → —', () => {
    expect(formatDateTimeShort(null)).toBe('—')
  })

  it('undefined → —', () => {
    expect(formatDateTimeShort(undefined)).toBe('—')
  })

  it('invalid date string → —', () => {
    expect(formatDateTimeShort('garbage')).toBe('—')
  })
})
