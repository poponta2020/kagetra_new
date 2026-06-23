/**
 * Unit tests for parseRoundCellText — the shared round-cell text parser used by
 * the HTML result parser (W1) and, later, the positional Excel layout (W2).
 *
 * A "round cell" packs マーク (○/×) ・ 枚数 ・ 相手 separated by whitespace, e.g.
 * "○ 4 北野律子". Names here are synthetic; real data is git-external.
 */

import { describe, expect, it } from 'vitest'
import { parseRoundCellText } from '../../src/result-import/round-cell.js'

describe('parseRoundCellText', () => {
  it('parses a standard win cell (mark / 枚数 / 相手)', () => {
    expect(parseRoundCellText('○ 4 相手花子')).toEqual({
      result: 'win',
      scoreDiff: 4,
      status: 'normal',
      opponentName: '相手花子',
      empty: false,
    })
  })

  it('parses a standard lose cell', () => {
    expect(parseRoundCellText('× 12 相手太郎')).toEqual({
      result: 'lose',
      scoreDiff: 12,
      status: 'normal',
      opponentName: '相手太郎',
      empty: false,
    })
  })

  it('treats 〇 (U+3007) as win', () => {
    expect(parseRoundCellText('〇 5 相手').result).toBe('win')
  })

  it('treats ✕ (U+2715) as lose', () => {
    expect(parseRoundCellText('✕ 5 相手').result).toBe('lose')
  })

  it('collapses heavy whitespace/newlines (HTML cell shape)', () => {
    expect(parseRoundCellText('\n\t\t○\n\t\t4\n\t\t相手花子\n')).toEqual({
      result: 'win',
      scoreDiff: 4,
      status: 'normal',
      opponentName: '相手花子',
      empty: false,
    })
  })

  it('parses a 不戦 (bye) cell as walkover win with no opponent/score', () => {
    expect(parseRoundCellText('不戦')).toEqual({
      result: 'win',
      scoreDiff: null,
      status: 'walkover',
      opponentName: null,
      empty: false,
    })
  })

  it('parses 不戦勝 likewise as walkover win', () => {
    expect(parseRoundCellText('不戦勝')).toEqual({
      result: 'win',
      scoreDiff: null,
      status: 'walkover',
      opponentName: null,
      empty: false,
    })
  })

  it('parses 棄権 with explicit lose mark as forfeit lose', () => {
    expect(parseRoundCellText('棄権 × 相手太郎')).toEqual({
      result: 'lose',
      scoreDiff: null,
      status: 'forfeit',
      opponentName: '相手太郎',
      empty: false,
    })
  })

  it('parses bare 棄権 as forfeit lose (the withdrawing player)', () => {
    expect(parseRoundCellText('棄権')).toEqual({
      result: 'lose',
      scoreDiff: null,
      status: 'forfeit',
      opponentName: null,
      empty: false,
    })
  })

  it('marks a blank cell as empty', () => {
    expect(parseRoundCellText('')).toEqual({
      result: null,
      scoreDiff: null,
      status: 'normal',
      opponentName: null,
      empty: true,
    })
    expect(parseRoundCellText('   \n\t ').empty).toBe(true)
  })

  it('preserves an internal space in the opponent name', () => {
    expect(parseRoundCellText('○ 5 山田 太郎').opponentName).toBe('山田 太郎')
  })
})
