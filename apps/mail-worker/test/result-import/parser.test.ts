/**
 * Parser unit tests using inline anonymized grid data.
 *
 * Real Excel files (which contain player names) are kept in docs/調査用/ and
 * are NOT committed to git. These tests use hand-crafted minimal grids that
 * represent each structural variant discovered in the 42-file survey.
 *
 * Coverage targets (from requirements §3.4):
 *  - Standard per-class sheet: 5 rounds, winner/loser both rows
 *  - 不戦勝 (walkover) — opponent null, score null, result=win, status=walkover
 *  - 棄権 (forfeit) — opponent present, score null, status=forfeit
 *  - ○ vs 〇 round-trip
 *  - Multi-class single sheet (伊助 出場者DB style) — grade+class column
 *  - Sheet without signature → skipped
 *  - Grade derivation from sheet name and class column
 */

import { describe, expect, it } from 'vitest'
import { parseResultExcel } from '../../src/result-import/parser.js'
import type { SheetData } from '../../src/result-import/reader.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSheet(name: string, rows: (string | null)[][]): SheetData {
  return { name, grid: rows }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Standard format — "対戦結果表_D1級" style
 * Row 0: class code cell
 * Row 1: round labels (merged → only first col of merge has value)
 * Row 2: header row (signature)
 * Row 3+: data
 *
 * 4 players, 2 rounds.  Player 1 wins both; Player 2 loses round 1 (went out).
 * Player 3 has 不戦勝 round 1 then loses round 2.
 * Player 4 has 棄権 round 1 (opponent wins forfeit), so status=forfeit for both rows.
 */
const STANDARD_SHEET: SheetData = makeSheet('対戦結果表_D1級', [
  // row 0: class code
  ['D1', null, null, null, null, null, null, null, null],
  // row 1: round labels (merged: 1回戦 covers cols 3-5, 2回戦 covers cols 6-8)
  [null, null, null, '1回戦', null, null, '2回戦', null, null, null],
  // row 2: header
  ['No', '選手名', '所属', '相手', '枚数', '勝敗', '相手', '枚数', '勝敗', '順位'],
  // P1: wins round1 vs P4 (score 12), wins round2 vs P2 (score 7)
  ['1', 'テスト一郎', '東京かるた会', 'テスト四郎', '12', '○', 'テスト二郎', '7', '○', '優勝'],
  // P2: loses round1 vs P1 (no more rounds)
  ['2', 'テスト二郎', 'かるた会B', 'テスト三郎', '5', '○', 'テスト一郎', '7', '×', '準優勝'],
  // P3: 不戦勝 round1, loses round2
  ['3', 'テスト三郎', 'かるた会C', null, '不戦勝', '○', 'テスト二郎', '5', '×', null],
  // P4: loses round1 (棄権 situation — opponent won via forfeit, P4 uses 棄権)
  ['4', 'テスト四郎', 'かるた会D', 'テスト一郎', '棄権', '×', null, null, null, null],
])

/**
 * Multi-class single sheet (伊助 出場者DB style).
 * No. | 級 | クラス | 段位 | 選手名 | 所属会 | 相手 | 枚数 | 勝敗 | 相手 | 枚数 | 勝敗
 * Two classes: A1 and A2, 1 player each, 1 round each.
 */
const MULTI_CLASS_SHEET: SheetData = makeSheet('出場者DB', [
  // row 0: title
  ['出場者DB', null, null, null, null, null, null, null, null, null, null, null],
  // row 1: round label row
  [null, null, null, null, null, null, null, '1回戦', null, null, '2回戦', null, null],
  // row 2: header
  ['No.', '級', 'クラス', '段位', '選手名', '所属会', null, '相手', '枚数', '勝敗', '相手', '枚数', '勝敗'],
  // A1 class player: wins round1, loses round2
  ['1', 'A級', 'A1', '5段', 'Aいちクラス選手', '東京会', null, '別選手', '7', '○', '別選手B', '3', '×'],
  // A2 class player: loses round1 only
  ['2', 'A級', 'A2', '4段', 'Aにクラス選手', '大阪会', null, '別選手', '9', '×', null, null, null],
])

/**
 * Sheet without universal signature — should be skipped entirely.
 */
const REPORT_SHEET: SheetData = makeSheet('大会報告', [
  ['小倉百人一首競技かるた　新 春 全 国', null, null],
  [null, null, '令 和 ６ 年 １ 月'],
  ['A 1 級', '優勝', 'テスト選手'],
])

/**
 * A级結果 single-grade sheet without "対戦結果表" prefix — class from sheet name
 */
const A_GRADE_SHEET: SheetData = makeSheet('A級結果', [
  [null, null, null, '1回戦', null, null, '2回戦', null, null],
  ['No.', '選手名', '所属', '相手', '枚数', '勝敗', '相手', '枚数', '勝敗', '順位'],
  ['1', 'A級選手甲', '甲会', 'A級選手乙', '15', '○', null, null, null, '優勝'],
  ['2', 'A級選手乙', '乙会', 'A級選手甲', '15', '×', null, null, null, null],
])

/**
 * 〇 (U+3007 IDEOGRAPHIC NUMBER ZERO) used instead of ○ — both should parse as win
 */
const MARU_VARIANT_SHEET: SheetData = makeSheet('対戦結果表_B1級', [
  [null, null, null, '1回戦', null, null],
  ['No', '選手名', '所属', '相手', '枚数', '勝敗'],
  ['1', '丸記号選手', '丸会', '相手選手', '8', '〇'],
  ['2', '相手選手', '相手会', '丸記号選手', '8', '×'],
])

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseResultExcel — standard per-class sheet', () => {
  const classes = parseResultExcel([STANDARD_SHEET, REPORT_SHEET])

  it('skips 大会報告 sheet (no signature)', () => {
    expect(classes).toHaveLength(1)
  })

  it('derives class name D1 from sheet name', () => {
    expect(classes[0]?.className).toBe('D1')
  })

  it('derives grade D', () => {
    expect(classes[0]?.grade).toBe('D')
  })

  it('extracts 4 participants', () => {
    expect(classes[0]?.participants).toHaveLength(4)
  })

  it('player 1 has 2 wins (normal status)', () => {
    const p1 = classes[0]!.participants.find((p) => p.name === 'テスト一郎')!
    expect(p1).toBeDefined()
    expect(p1.matches).toHaveLength(2)
    expect(p1.matches.every((m) => m.result === 'win' && m.status === 'normal')).toBe(true)
    expect(p1.finalRank).toBe('優勝')
  })

  it('player 2 has 1 win then 1 lose', () => {
    const p2 = classes[0]!.participants.find((p) => p.name === 'テスト二郎')!
    expect(p2.matches).toHaveLength(2)
    expect(p2.matches[0]?.result).toBe('win')
    expect(p2.matches[1]?.result).toBe('lose')
  })

  it('player 3: round 1 is walkover (不戦勝)', () => {
    const p3 = classes[0]!.participants.find((p) => p.name === 'テスト三郎')!
    expect(p3.matches).toHaveLength(2)
    const m1 = p3.matches[0]!
    expect(m1.status).toBe('walkover')
    expect(m1.result).toBe('win')
    expect(m1.scoreDiff).toBeNull()
    expect(m1.opponentName).toBeNull()
  })

  it('player 4: round 1 is forfeit (棄権)', () => {
    const p4 = classes[0]!.participants.find((p) => p.name === 'テスト四郎')!
    expect(p4.matches).toHaveLength(1)
    const m1 = p4.matches[0]!
    expect(m1.status).toBe('forfeit')
    expect(m1.result).toBe('lose')
    expect(m1.scoreDiff).toBeNull()
  })

  it('round labels are extracted', () => {
    const p1 = classes[0]!.participants.find((p) => p.name === 'テスト一郎')!
    expect(p1.matches[0]?.roundLabel).toBe('1回戦')
    expect(p1.matches[1]?.roundLabel).toBe('2回戦')
  })

  it('round numbers are 1-based', () => {
    const p1 = classes[0]!.participants.find((p) => p.name === 'テスト一郎')!
    expect(p1.matches[0]?.round).toBe(1)
    expect(p1.matches[1]?.round).toBe(2)
  })
})

describe('parseResultExcel — multi-class single sheet (伊助 出場者DB)', () => {
  const classes = parseResultExcel([MULTI_CLASS_SHEET])

  it('produces 2 classes from one sheet', () => {
    expect(classes).toHaveLength(2)
  })

  it('first class is A1', () => {
    expect(classes[0]?.className).toBe('A1')
    expect(classes[0]?.grade).toBe('A')
  })

  it('second class is A2', () => {
    expect(classes[1]?.className).toBe('A2')
    expect(classes[1]?.grade).toBe('A')
  })

  it('A1 player has 2 matches', () => {
    expect(classes[0]?.participants[0]?.matches).toHaveLength(2)
  })

  it('A2 player has 1 match (only round 1 played)', () => {
    expect(classes[1]?.participants[0]?.matches).toHaveLength(1)
  })

  it('extracts 段位', () => {
    expect(classes[0]?.participants[0]?.dan).toBe('5段')
  })
})

describe('parseResultExcel — A級結果 (single grade, no 対戦結果表 prefix)', () => {
  const classes = parseResultExcel([A_GRADE_SHEET])

  it('derives grade A from sheet name "A級結果"', () => {
    expect(classes[0]?.grade).toBe('A')
  })

  it('player 1 wins round 1', () => {
    const p = classes[0]!.participants.find((p) => p.name === 'A級選手甲')!
    expect(p.matches[0]?.result).toBe('win')
    expect(p.finalRank).toBe('優勝')
  })
})

describe('parseResultExcel — 〇 (U+3007) treated as win', () => {
  const classes = parseResultExcel([MARU_VARIANT_SHEET])

  it('parses 〇 as win', () => {
    const winner = classes[0]!.participants.find((p) => p.name === '丸記号選手')!
    expect(winner.matches[0]?.result).toBe('win')
  })
})

describe('parseResultExcel — all non-signature sheets', () => {
  it('returns empty array', () => {
    expect(parseResultExcel([REPORT_SHEET])).toEqual([])
  })
})
