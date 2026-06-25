import { describe, expect, it } from 'vitest'
import {
  normalizeText,
  deriveGrade,
  parseResultChar,
  parseScoreCell,
  normalizePlayerName,
  normalizeDan,
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

describe('normalizeDan', () => {
  // The raw 段位 column is heterogeneous across formats: 初段 / 初 / 1段 / １段 / 壱 / 一,
  // 二段 / 2段 / 弐 / 二, … — all must fold to the same orderable rank 1–10.
  it.each([
    ['初段', 1], ['初', 1], ['1段', 1], ['１段', 1], ['壱', 1], ['一', 1],
    ['二段', 2], ['2段', 2], ['２段', 2], ['弐段', 2], ['弐', 2], ['二', 2], ['弍', 2], ['ニ', 2],
    ['三段', 3], ['3段', 3], ['参段', 3], ['参', 3], ['三', 3],
    ['四段', 4], ['四', 4], ['4段', 4],
    ['五段', 5], ['五', 5],
    ['六段', 6], ['六', 6],
    ['七段', 7],
    ['八段', 8], ['八', 8],
    ['九段', 9], ['九', 9],
    ['十段', 10], ['10段', 10], ['十', 10],
  ])('folds %s → rank %i', (input, rank) => {
    expect(normalizeDan(input as string)).toBe(rank)
  })

  it.each([
    [null], [undefined], [''], ['.'], ['無'], ['無段'], ['無級'],
    ['●'], ['★'], ['-'], ['A級'], ['初級'], ['13'], ['100'], ['だん'],
  ])('returns null for non-dan / no-dan value: %s', (input) => {
    expect(normalizeDan(input as string | null | undefined)).toBeNull()
  })
})
