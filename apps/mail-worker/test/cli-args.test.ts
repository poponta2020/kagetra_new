import { describe, it, expect } from 'vitest'
import { parseSinceArg } from '../src/cli-args.js'

describe('parseSinceArg', () => {
  it('parses bare YYYY-MM-DD as JST start-of-day (00:00 JST = 15:00 UTC prev day)', () => {
    // 2026-04-12 00:00:00+09:00 == 2026-04-11T15:00:00.000Z
    const d = parseSinceArg('2026-04-12')
    expect(d.toISOString()).toBe('2026-04-11T15:00:00.000Z')
  })

  it('does not silently drop mails received between 00:00 and 09:00 JST on the requested day', () => {
    // Regression guard: a mail with internalDate 2026-04-12 03:00 JST
    // (== 2026-04-11T18:00:00Z) must satisfy `receivedAt >= since`.
    const since = parseSinceArg('2026-04-12')
    const mailReceivedAt = new Date('2026-04-11T18:00:00Z') // 2026-04-12 03:00 JST
    expect(mailReceivedAt >= since).toBe(true)
  })

  it('passes through ISO datetime with explicit offset unchanged', () => {
    const d = parseSinceArg('2026-04-12T15:00:00+09:00')
    expect(d.toISOString()).toBe('2026-04-12T06:00:00.000Z')
  })

  it('passes through ISO datetime with Z (UTC) unchanged', () => {
    const d = parseSinceArg('2026-04-12T00:00:00Z')
    expect(d.toISOString()).toBe('2026-04-12T00:00:00.000Z')
  })

  it('treats offset-less ISO datetime as JST (regression guard for r4 nit)', () => {
    // Without explicit offset, `new Date('2026-04-12T15:00:00')` was parsed in
    // the runtime's local timezone — so the same input meant 06:00 UTC on a
    // dev box (JST) but 15:00 UTC in production (UTC), a 9-hour skew. Pin the
    // contract: offset-less datetime == JST.
    const d = parseSinceArg('2026-04-12T15:00:00')
    expect(d.toISOString()).toBe('2026-04-12T06:00:00.000Z')
  })

  it('treats offset-less datetime with fractional seconds as JST', () => {
    const d = parseSinceArg('2026-04-12T15:00:00.500')
    expect(d.toISOString()).toBe('2026-04-12T06:00:00.500Z')
  })

  it('passes through ISO datetime with negative offset unchanged', () => {
    // 2026-04-12T20:00:00-05:00 == 2026-04-13T01:00:00Z
    const d = parseSinceArg('2026-04-12T20:00:00-05:00')
    expect(d.toISOString()).toBe('2026-04-13T01:00:00.000Z')
  })

  it('throws on unparseable input', () => {
    expect(() => parseSinceArg('not-a-date')).toThrow(/parseable date/)
  })
})
