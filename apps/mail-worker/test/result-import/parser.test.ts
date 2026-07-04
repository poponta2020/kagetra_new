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

// 練習シートは本番の級と同じ className に解決されて merge 規則で本番参加者へ
// 合流してしまう(東京東会「対戦結果表_E級練習」の実害)ため、丸ごと skip する。
describe('parseResultExcel — sheets named 練習 are skipped', () => {
  const PRACTICE_SHEET: SheetData = makeSheet('対戦結果表_D1級練習', [
    ['D1', null, null, null, null, null],
    [null, null, null, '1回戦', null, null],
    ['No', '選手名', '所属', '相手', '枚数', '勝敗'],
    ['1', '練習選手甲', '練習会', '練習選手乙', '3', '○'],
    ['2', '練習選手乙', '練習会', '練習選手甲', '3', '×'],
  ])

  it('does not merge a 練習 sheet into the real class of the same name', () => {
    const classes = parseResultExcel([STANDARD_SHEET, PRACTICE_SHEET])
    expect(classes).toHaveLength(1)
    expect(classes[0]?.participants).toHaveLength(4)
    expect(classes[0]?.participants.some((p) => p.name.startsWith('練習選手'))).toBe(false)
  })

  it('returns empty when only 練習 sheets are present', () => {
    expect(parseResultExcel([PRACTICE_SHEET])).toEqual([])
  })
})

// Codex R4 blocker: a class split across two sheets (same derived className)
// must MERGE participants, not silently drop the second sheet.
describe('parseResultExcel — duplicate className across sheets is merged', () => {
  it('merges participants from both sheets (no data loss)', () => {
    const sheetA = makeSheet('D1級その1', [
      ['選手名', '相手', '枚数', '勝敗'],
      ['選手A', '選手B', '5', '○'],
      ['選手B', '選手A', '5', '×'],
    ])
    const sheetB = makeSheet('D1級その2', [
      ['選手名', '相手', '枚数', '勝敗'],
      ['選手C', '選手D', '3', '○'],
      ['選手D', '選手C', '3', '×'],
    ])
    const classes = parseResultExcel([sheetA, sheetB])
    expect(classes).toHaveLength(1)
    expect(classes[0]!.className).toBe('D1')
    expect(classes[0]!.participants.map((p) => p.name)).toEqual([
      '選手A',
      '選手B',
      '選手C',
      '選手D',
    ])
  })
})

// Codex R4 should_fix: a round block wider than 相手/枚数/勝敗 (here with a
// 備考 column) must still read 勝敗 from its explicit header, not a fixed offset.
describe('parseResultExcel — 4-column round block (相手/枚数/備考/勝敗)', () => {
  it('reads 勝敗 from the header, not opCol+2 (備考)', () => {
    const sheet = makeSheet('対戦結果表_E1級', [
      ['選手名', '相手', '枚数', '備考', '勝敗'],
      ['選手甲', '選手乙', '8', 'メモ', '○'],
    ])
    const classes = parseResultExcel([sheet])
    expect(classes).toHaveLength(1)
    const p = classes[0]!.participants.find((x) => x.name === '選手甲')!
    expect(p.matches).toHaveLength(1)
    expect(p.matches[0]?.result).toBe('win')
    expect(p.matches[0]?.scoreDiff).toBe(8)
    expect(p.matches[0]?.opponentName).toBe('選手乙')
  })
})

/**
 * 伊助 出場者DB — REAL layout carrying BOTH 選手名 + 選手名ふりがな AND 所属会 + 所属会2.
 * Regression for the duplicate-column bug: last-match-wins picked 選手名ふりがな (→ every
 * name imported as hiragana) and 所属会2 (usually blank → empty affiliation), which ALSO
 * broke opponent resolution downstream (hiragana own-name vs kanji opponent-name never
 * matched). 13 of 42 surveyed workbooks hit this. 所属会2 is intentionally blank to match
 * real files. The pre-fix MULTI_CLASS_SHEET fixture lacked these duplicate columns, so it
 * never caught the bug.
 */
const SHUSSHA_DB_DUP_COLS_SHEET: SheetData = makeSheet('出場者DB', [
  ['出場者DB', null, null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, '1回戦', null, null, '2回戦', null, null],
  ['No.', '級', 'クラス', '段位', '選手名', '選手名ふりがな', '所属会', '所属会2', '相手', '枚数', '勝敗', '相手', '枚数', '勝敗'],
  ['1', 'A級', 'A1', '5段', '漢字太郎', 'かんじたろう', '東京会', null, '漢字次郎', '7', '○', '漢字三郎', '3', '×'],
  ['2', 'A級', 'A2', '4段', '漢字次郎', 'かんじじろう', '大阪会', null, '漢字太郎', '9', '×', null, null, null],
])

describe('parseResultExcel — 出場者DB with 選手名ふりがな + 所属会2 (regression)', () => {
  const classes = parseResultExcel([SHUSSHA_DB_DUP_COLS_SHEET])
  const p1 = classes[0]!.participants[0]!

  it('uses the kanji 選手名 column, NOT 選手名ふりがな', () => {
    expect(p1.name).toBe('漢字太郎')
    expect(p1.name).not.toBe('かんじたろう')
  })

  it('captures 選手名ふりがな as nameKana (no longer dropped)', () => {
    expect(p1.nameKana).toBe('かんじたろう')
  })

  it('uses 所属会 (primary), NOT the blank 所属会2', () => {
    expect(p1.affiliation).toBe('東京会')
  })

  it('keeps opponent names as kanji that match participant names (resolvable downstream)', () => {
    const p2 = classes[1]!.participants[0]!
    expect(p2.name).toBe('漢字次郎')
    // own name (kanji) and opponent name (kanji) are in the same script → materialize
    // can normalize-match them; pre-fix the own name was hiragana and never matched.
    expect(p1.matches[0]?.opponentName).toBe('漢字次郎')
  })
})

/**
 * ◯ (U+25EF LARGE CIRCLE) used as the win mark — the shape used by the real
 * 東京東会79回 / 千葉2024+ result files. Regression for the mirror-missing-100% bug
 * (Issue #264): pre-fix, every ◯ round was dropped as unparseable, so only the
 * loser-side rows survived (winners had matches=[]) and no match had its mirror.
 */
const U25EF_VARIANT_SHEET: SheetData = makeSheet('対戦結果表_A級', [
  [null, null, null, '1回戦', null, null, '2回戦', null, null],
  ['No', '選手名', '所属', '相手', '枚数', '勝敗', '相手', '枚数', '勝敗', '順位'],
  ['1', '大丸勝者', '甲会', '大丸敗者', '6', '◯', '大丸次鋒', '15', '◯', '優勝'],
  ['2', '大丸敗者', '乙会', '大丸勝者', '6', '×', null, null, null, null],
  ['3', '大丸次鋒', '丙会', null, '不戦勝', '◯', '大丸勝者', '15', '×', null],
])

describe('parseResultExcel — ◯ (U+25EF) treated as win (Issue #264 regression)', () => {
  const classes = parseResultExcel([U25EF_VARIANT_SHEET])
  const cls = classes[0]!

  it('keeps the undefeated winner rows (pre-fix they were dropped entirely)', () => {
    const winner = cls.participants.find((p) => p.name === '大丸勝者')!
    expect(winner.matches).toHaveLength(2)
    expect(winner.matches.map((m) => m.result)).toEqual(['win', 'win'])
  })

  it('produces both sides of every normal match (mirror completeness)', () => {
    // every (player, round, opponent, result) must have the reciprocal row
    for (const p of cls.participants) {
      for (const m of p.matches) {
        if (!m.opponentName) continue // 不戦勝 has no reciprocal
        const opp = cls.participants.find((q) => q.name === m.opponentName)!
        const back = opp.matches.find((bm) => bm.round === m.round)
        expect(back?.opponentName).toBe(p.name)
        expect(back?.result).toBe(m.result === 'win' ? 'lose' : 'win')
      }
    }
  })

  it('accepts ◯ on a walkover cell too', () => {
    const bye = cls.participants.find((p) => p.name === '大丸次鋒')!
    expect(bye.matches[0]).toMatchObject({ result: 'win', status: 'walkover', opponentName: null })
  })
})

/**
 * 「氏(U+3000)名」 header — ideographic space inside the label, real 千葉2026 layout.
 * Pre-fix isPlayerNameHeader tested /氏名/ against the normalized cell where the
 * full-width space survives as an ASCII space ("氏 名"), so the primary detector
 * missed the sheet and fell through to the W2 positional fallback, which nulled
 * every opponent/score. The row-0 title cell is the only place the grade appears
 * (the sheet name is a block label), so this fixture also covers the title-cell
 * class derivation: 優勝1 + （Ａ級） → className "A1", grade "A".
 */
const CHIBA_2026_SHEET: SheetData = makeSheet('優勝1', [
  [null, '【第４回全国競技かるた千葉大会（Ａ級）】', null, null, null, null],
  [null, null, null, '1回戦', null, null],
  [null, '氏　名', '所属会名', '相手', '枚数', '勝敗'],
  ['優勝', '千葉勝子', 'てすと会', '千葉負男', '3', '◯'],
  [null, '千葉負男', 'てすと会2', '千葉勝子', '3', '×'],
])

describe('parseResultExcel — 「氏　名」 header + title-cell grade (千葉2026, Issue #264)', () => {
  const classes = parseResultExcel([CHIBA_2026_SHEET])

  it('detects the primary signature (opponents survive, unlike the W2 fallback)', () => {
    expect(classes).toHaveLength(1)
    const winner = classes[0]!.participants.find((p) => p.name === '千葉勝子')!
    expect(winner.matches[0]).toMatchObject({
      result: 'win',
      scoreDiff: 3,
      opponentName: '千葉負男',
      round: 1,
    })
  })

  it('derives className from the parenthesized grade in the title cell, not the sheet name', () => {
    // 優勝1 (block label) would otherwise become the className with grade=null
    expect(classes[0]!.className).toBe('A1')
    expect(classes[0]!.grade).toBe('A')
  })
})

describe('deriveClassNameFromSheet title-cell fallback — no trailing block number', () => {
  it('uses the bare grade when the sheet name has no block suffix', () => {
    const sheet = makeSheet('結果', [
      ['【第５回テスト大会（Ｂ級）】', null, null, null, null],
      ['氏　名', '所属会名', '相手', '枚数', '勝敗'],
      ['勝田花子', '会イ', '負田太郎', '7', '◯'],
      ['負田太郎', '会ロ', '勝田花子', '7', '×'],
    ])
    const classes = parseResultExcel([sheet])
    expect(classes).toHaveLength(1)
    expect(classes[0]!.className).toBe('B')
    expect(classes[0]!.grade).toBe('B')
  })
})
