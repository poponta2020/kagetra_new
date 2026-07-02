import { describe, it, expect } from 'vitest'
import { surname } from './surname'

describe('surname', () => {
  it('splits on an ASCII space and takes the leading segment', () => {
    expect(surname('山田 太郎')).toBe('山田')
  })

  it('splits on a full-width space and takes the leading segment', () => {
    expect(surname('山田　太郎')).toBe('山田')
  })

  it('returns the whole name when there is no space', () => {
    expect(surname('山田太郎')).toBe('山田太郎')
  })

  it('returns ? for null', () => {
    expect(surname(null)).toBe('?')
  })

  it('returns ? for undefined', () => {
    expect(surname(undefined)).toBe('?')
  })

  it('returns ? for an empty string', () => {
    expect(surname('')).toBe('?')
  })

  it('falls back to the full name when the first segment is empty (leading space)', () => {
    // Matches the original detail-page behaviour: parts[0] falsy -> return name.
    expect(surname(' 太郎')).toBe(' 太郎')
  })
})
