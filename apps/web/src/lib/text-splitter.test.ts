import { describe, it, expect } from 'vitest'
import { splitForLine } from './text-splitter'

describe('splitForLine', () => {
  it('returns empty array for empty input', () => {
    expect(splitForLine('')).toEqual([])
  })

  it('returns input unchanged when within limit', () => {
    const short = 'a'.repeat(100)
    expect(splitForLine(short, { limit: 5000 })).toEqual([short])
  })

  it('preserves total length when split (no characters lost)', () => {
    const body = 'a'.repeat(12_000) + '\n\nB\n\n' + 'b'.repeat(3000)
    const parts = splitForLine(body, { limit: 5000 })
    expect(parts.join('')).toBe(body)
  })

  it('every chunk fits the limit', () => {
    const body =
      'Paragraph one.\n\n' +
      'Paragraph two with more text here.\n\n' +
      'X'.repeat(7000) +
      '\n\n' +
      'Final.'
    const parts = splitForLine(body, { limit: 5000 })
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(5000)
    }
  })

  it('prefers paragraph breaks when available', () => {
    const para = 'X'.repeat(4000)
    const body = `${para}\n\n${para}`
    const parts = splitForLine(body, { limit: 5000 })
    expect(parts).toHaveLength(2)
    expect(parts[0]!).toMatch(/X\n\n$/)
    expect(parts[1]!).toMatch(/^X/)
  })

  it('falls back to sentence boundaries when no paragraph break fits', () => {
    const sentence = 'これはテスト文章です。'
    const body = sentence.repeat(500) // ~10,000 chars, no paragraph breaks
    const parts = splitForLine(body, { limit: 5000 })
    expect(parts.length).toBeGreaterThan(1)
    // Every chunk except possibly the last should end with a sentence-final
    // character so the boundary is not awkward mid-clause.
    for (const p of parts.slice(0, -1)) {
      const last = p.at(-1)
      expect(['。', '！', '？', '!', '?', '\n']).toContain(last)
    }
  })

  it('hard-cuts inputs with no boundaries inside the limit', () => {
    const body = 'X'.repeat(12_345)
    const parts = splitForLine(body, { limit: 5000 })
    expect(parts).toHaveLength(3)
    expect(parts[0]!.length).toBe(5000)
    expect(parts[1]!.length).toBe(5000)
    expect(parts[2]!.length).toBe(2345)
  })

  it('does not split surrogate pairs on hard cut', () => {
    // U+1F389 (🎉) is a surrogate pair. Build a string ending exactly at
    // the hard-cut boundary so naïve substring would split the pair.
    const filler = 'X'.repeat(4999)
    const body = filler + '🎉' + 'X'.repeat(5000)
    const parts = splitForLine(body, { limit: 5000 })
    for (const p of parts) {
      // Iterating with `for..of` produces code points; if a surrogate were
      // dangling it would render as U+FFFD or throw on TextEncoder. Cheaper
      // check: nothing in the string should be a lone low surrogate.
      for (let i = 0; i < p.length; i++) {
        const code = p.charCodeAt(i)
        if (code >= 0xdc00 && code <= 0xdfff) {
          const prev = i > 0 ? p.charCodeAt(i - 1) : 0
          expect(prev).toBeGreaterThanOrEqual(0xd800)
          expect(prev).toBeLessThanOrEqual(0xdbff)
        }
      }
    }
  })

  it('throws on non-positive limit', () => {
    expect(() => splitForLine('abc', { limit: 0 })).toThrow()
  })
})
