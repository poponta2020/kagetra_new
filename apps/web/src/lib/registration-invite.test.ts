import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EXPIRY_PRESET,
  EXPIRY_PRESETS,
  EXPIRY_PRESET_OPTIONS,
  generateRegistrationToken,
  isRegistrationInviteExpired,
  isRegistrationInviteUsable,
  isValidExpiryPreset,
  registrationInviteExpiresAt,
} from './registration-invite'

describe('generateRegistrationToken', () => {
  it('returns a 43-char URL-safe base64url string (32 random bytes)', () => {
    for (let i = 0; i < 200; i++) {
      const token = generateRegistrationToken()
      // base64url alphabet only: A-Z a-z 0-9 - _ , no padding
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('produces unique tokens (no collisions across many draws)', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) tokens.add(generateRegistrationToken())
    expect(tokens.size).toBe(1000)
  })
})

describe('EXPIRY_PRESETS', () => {
  it('maps each preset to its day count in ms', () => {
    expect(EXPIRY_PRESETS['1d']).toBe(86_400_000)
    expect(EXPIRY_PRESETS['7d']).toBe(7 * 86_400_000)
    expect(EXPIRY_PRESETS['30d']).toBe(30 * 86_400_000)
  })

  it('defaults to 7 days and lists presets shortest-first', () => {
    expect(DEFAULT_EXPIRY_PRESET).toBe('7d')
    expect(EXPIRY_PRESET_OPTIONS).toEqual(['1d', '7d', '30d'])
  })
})

describe('isValidExpiryPreset', () => {
  it.each(['1d', '7d', '30d'])('accepts %s', (p) => {
    expect(isValidExpiryPreset(p)).toBe(true)
  })

  it.each(['', '2d', '7', 'd7', '365d', ' 7d', null, undefined, 7])(
    'rejects %s',
    (input) => {
      expect(isValidExpiryPreset(input)).toBe(false)
    },
  )
})

describe('registrationInviteExpiresAt', () => {
  const now = new Date('2026-06-26T00:00:00Z')

  it('adds the preset TTL to the given timestamp', () => {
    expect(registrationInviteExpiresAt('1d', now).toISOString()).toBe('2026-06-27T00:00:00.000Z')
    expect(registrationInviteExpiresAt('7d', now).toISOString()).toBe('2026-07-03T00:00:00.000Z')
    expect(registrationInviteExpiresAt('30d', now).toISOString()).toBe('2026-07-26T00:00:00.000Z')
  })

  it('defaults `now` to the current time', () => {
    const before = Date.now()
    const expires = registrationInviteExpiresAt('1d').getTime()
    const after = Date.now()
    expect(expires - before).toBeGreaterThanOrEqual(EXPIRY_PRESETS['1d'] - 50)
    expect(expires - after).toBeLessThanOrEqual(EXPIRY_PRESETS['1d'])
  })
})

describe('isRegistrationInviteExpired', () => {
  const now = new Date('2026-06-26T03:00:00Z')

  it('returns true for null / undefined', () => {
    expect(isRegistrationInviteExpired(null, now)).toBe(true)
    expect(isRegistrationInviteExpired(undefined, now)).toBe(true)
  })

  it('returns false for a future expiry', () => {
    expect(isRegistrationInviteExpired(new Date('2026-06-26T03:00:01Z'), now)).toBe(false)
  })

  it('returns true for a past expiry', () => {
    expect(isRegistrationInviteExpired(new Date('2026-06-26T02:59:59Z'), now)).toBe(true)
  })

  it('treats an equal timestamp as expired (closed interval)', () => {
    expect(isRegistrationInviteExpired(new Date('2026-06-26T03:00:00Z'), now)).toBe(true)
  })
})

describe('isRegistrationInviteUsable', () => {
  const now = new Date('2026-06-26T03:00:00Z')
  const future = new Date('2026-06-27T03:00:00Z')
  const past = new Date('2026-06-25T03:00:00Z')

  it('returns true for an unrevoked, unexpired invite', () => {
    expect(isRegistrationInviteUsable({ revokedAt: null, expiresAt: future }, now)).toBe(true)
  })

  it('returns false when the invite row is missing', () => {
    expect(isRegistrationInviteUsable(null, now)).toBe(false)
    expect(isRegistrationInviteUsable(undefined, now)).toBe(false)
  })

  it('returns false when revoked, even if not yet expired', () => {
    expect(
      isRegistrationInviteUsable({ revokedAt: new Date('2026-06-26T02:00:00Z'), expiresAt: future }, now),
    ).toBe(false)
  })

  it('returns false when expired, even if not revoked', () => {
    expect(isRegistrationInviteUsable({ revokedAt: null, expiresAt: past }, now)).toBe(false)
  })
})
