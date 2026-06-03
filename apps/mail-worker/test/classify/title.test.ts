import { describe, expect, it } from 'vitest'
import { composeTitle } from '../../src/classify/title.js'

describe('composeTitle', () => {
  it('joins grades in A→E order after the stem', () => {
    expect(composeTitle('東大阪', ['A', 'B', 'C'])).toBe('東大阪ABC')
  })

  it('is independent of the input grade order', () => {
    expect(composeTitle('東大阪', ['C', 'A', 'B'])).toBe('東大阪ABC')
    expect(composeTitle('x', ['E', 'A'])).toBe('xAE')
  })

  it('appends a single grade', () => {
    expect(composeTitle('酒田', ['B'])).toBe('酒田B')
  })

  it('joins all five grades as ABCDE', () => {
    expect(composeTitle('○○', ['A', 'B', 'C', 'D', 'E'])).toBe('○○ABCDE')
  })

  it('returns the stem only when grades is null', () => {
    expect(composeTitle('○○', null)).toBe('○○')
  })

  it('returns the stem only when grades is empty', () => {
    expect(composeTitle('○○', [])).toBe('○○')
  })

  it('de-duplicates repeated grades', () => {
    expect(composeTitle('x', ['A', 'A', 'B'])).toBe('xAB')
  })

  it('ignores values outside A–E', () => {
    expect(composeTitle('x', ['A', 'Z', 'B'])).toBe('xAB')
  })

  it('trims surrounding whitespace on the stem', () => {
    expect(composeTitle('  東大阪  ', ['A'])).toBe('東大阪A')
  })

  it('treats a null stem as empty', () => {
    expect(composeTitle(null, ['A', 'B'])).toBe('AB')
    expect(composeTitle(null, null)).toBe('')
  })
})
