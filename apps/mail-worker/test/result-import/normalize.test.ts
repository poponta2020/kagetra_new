import { describe, expect, it } from 'vitest'
import {
  normalizeText,
  deriveGrade,
  parseResultChar,
  parseScoreCell,
  normalizePlayerName,
} from '../../src/result-import/normalize.js'

describe('normalizeText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  山田　太郎  ')).toBe('山田 太郎')
  })
  it('applies NFKC normalization', () => {
    // Full-width digit → ASCII
    expect(normalizeText('１２３')).toBe('123')
  })
})

describe('deriveGrade', () => {
  it.each([
    ['A1', 'A'],
    ['A級', 'A'],
    ['B2', 'B'],
    ['D12', 'D'],
    ['対戦結果表_D1級', 'D'],
    ['E級結果', 'E'],
    ['A級 A1', 'A'],
  ])('derives grade from %s → %s', (input, expected) => {
    expect(deriveGrade(input)).toBe(expected)
  })

  it('returns null for sheet without grade letter', () => {
    expect(deriveGrade('大会報告')).toBeNull()
    expect(deriveGrade('詳細結果')).toBeNull()
  })
})

describe('parseResultChar', () => {
  it('parses ○ (U+25CB) as win', () => expect(parseResultChar('○')).toBe('win'))
  it('parses 〇 (U+3007) as win', () => expect(parseResultChar('〇')).toBe('win'))
  it('parses × as lose', () => expect(parseResultChar('×')).toBe('lose'))
  it('parses ● (U+25CF, 負 in some 成績表) as lose', () => expect(parseResultChar('●')).toBe('lose'))
  it('returns null for empty/unknown', () => {
    expect(parseResultChar('')).toBeNull()
    expect(parseResultChar('-')).toBeNull()
  })
})

describe('parseScoreCell', () => {
  it('parses integer score', () => {
    expect(parseScoreCell('12')).toEqual({ scoreDiff: 12, isWalkover: false, isForfeit: false })
  })
  it('parses 不戦勝 as walkover', () => {
    expect(parseScoreCell('不戦勝')).toEqual({ scoreDiff: null, isWalkover: true, isForfeit: false })
  })
  it('parses 棄権 as forfeit', () => {
    expect(parseScoreCell('棄権')).toEqual({ scoreDiff: null, isWalkover: false, isForfeit: true })
  })
  it('handles null/undefined', () => {
    expect(parseScoreCell(null)).toEqual({ scoreDiff: null, isWalkover: false, isForfeit: false })
  })
})

describe('normalizePlayerName', () => {
  it('strips all spaces', () => {
    expect(normalizePlayerName('山田　太郎')).toBe('山田太郎')
    expect(normalizePlayerName('山田 太郎')).toBe('山田太郎')
  })
  it('normalizes kanji variants', () => {
    expect(normalizePlayerName('髙橋')).toBe('高橋')
    expect(normalizePlayerName('渡邉')).toBe('渡辺')
  })
})
