import { describe, it, expect } from 'vitest'
import {
  INVITE_CODE_TTL_MS,
  generateInviteCode,
  inviteCodeExpiresAt,
  isInviteCodeExpired,
  isValidInviteCodeFormat,
  verifyInviteCode,
} from './invite-code'

describe('generateInviteCode', () => {
  it('returns a 6-digit numeric string', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toMatch(/^\d{6}$/)
      expect(code).toHaveLength(6)
    }
  })

  it('zero-pads codes below 100000', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 500; i++) codes.add(generateInviteCode())
    const padded = [...codes].filter((c) => c.startsWith('0'))
    // With 100/1000 base probability per digit, 500 samples should yield
    // at least one zero-prefixed result — guarding the padStart logic.
    expect(padded.length).toBeGreaterThan(0)
  })
})

describe('inviteCodeExpiresAt', () => {
  it('adds the TTL to the given timestamp', () => {
    const now = new Date('2026-05-26T03:00:00Z')
    expect(inviteCodeExpiresAt(now).toISOString()).toBe('2026-05-26T03:30:00.000Z')
  })

  it('defaults `now` to current time', () => {
    const before = Date.now()
    const expires = inviteCodeExpiresAt().getTime()
    const after = Date.now()
    expect(expires - before).toBeGreaterThanOrEqual(INVITE_CODE_TTL_MS - 50)
    expect(expires - after).toBeLessThanOrEqual(INVITE_CODE_TTL_MS)
  })
})

describe('isInviteCodeExpired', () => {
  const now = new Date('2026-05-26T03:00:00Z')

  it('returns true for null / undefined', () => {
    expect(isInviteCodeExpired(null, now)).toBe(true)
    expect(isInviteCodeExpired(undefined, now)).toBe(true)
  })

  it('returns false for future timestamps', () => {
    expect(isInviteCodeExpired(new Date('2026-05-26T03:10:00Z'), now)).toBe(false)
  })

  it('returns true for past timestamps', () => {
    expect(isInviteCodeExpired(new Date('2026-05-26T02:59:59Z'), now)).toBe(true)
  })

  it('treats equal timestamps as expired', () => {
    expect(isInviteCodeExpired(new Date('2026-05-26T03:00:00Z'), now)).toBe(true)
  })
})

describe('isValidInviteCodeFormat', () => {
  it.each(['000000', '123456', '999999'])('accepts %s', (code) => {
    expect(isValidInviteCodeFormat(code)).toBe(true)
  })

  it.each(['12345', '1234567', 'abcdef', '12345a', '', ' 123456', '123456 '])(
    'rejects %s',
    (input) => {
      expect(isValidInviteCodeFormat(input)).toBe(false)
    },
  )
})

describe('verifyInviteCode', () => {
  const now = new Date('2026-05-26T03:00:00Z')
  const future = new Date('2026-05-26T03:10:00Z')
  const past = new Date('2026-05-26T02:50:00Z')

  it('returns ok for an exact match within expiry', () => {
    expect(verifyInviteCode('123456', '123456', future, now)).toEqual({ ok: true })
  })

  it('fails with format_invalid when input is not 6 digits', () => {
    expect(verifyInviteCode('12345', '123456', future, now)).toEqual({
      ok: false,
      reason: 'format_invalid',
    })
  })

  it('fails with not_issued when no code is stored', () => {
    expect(verifyInviteCode('123456', null, future, now)).toEqual({
      ok: false,
      reason: 'not_issued',
    })
    expect(verifyInviteCode('123456', undefined, future, now)).toEqual({
      ok: false,
      reason: 'not_issued',
    })
  })

  it('fails with expired when the stored code has elapsed', () => {
    expect(verifyInviteCode('123456', '123456', past, now)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('fails with expired when expiry is missing', () => {
    expect(verifyInviteCode('123456', '123456', null, now)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('fails with mismatch when codes differ', () => {
    expect(verifyInviteCode('123456', '654321', future, now)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('expired takes precedence over mismatch', () => {
    // The expiry guard runs before the equality check so an attacker can't
    // distinguish "wrong code" from "expired code" via the reason.
    expect(verifyInviteCode('111111', '654321', past, now)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })
})
