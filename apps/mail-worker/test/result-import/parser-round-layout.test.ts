/**
 * W2 — positional 「N回戦」 layout tests for parseResultExcel's fallback path
 * (detectRoundLayoutSignature). These sheets fail the primary signature (相手
 * AND 勝敗 in the SAME row) but carry per-player match data under 回戦 columns.
 *
 * Structures are taken from the real corpus (names synthetic):
 *  - chiba: 氏名|所属|級|1回戦… each round = [相手, ○/×, 枚数] positional, no sub-header
 *  - kuwana: 氏名 row + 相手/勝敗 sub-header row (split), 勝敗 cell packs score "○11"
 *  - masuda: split header, 勝敗 cell "○＋５" (full-width plus)
 * Guards: team-score tables (チーム名, no 氏名) and ranking summaries (no 回戦)
 * must NOT be parsed by the fallback.
 */

import { describe, expect, it } from 'vitest'
import { parseResultExcel } from '../../src/result-import/parser.js'
import { ParsedClassSchema } from '../../src/result-import/schema.js'
import type { SheetData } from '../../src/result-import/reader.js'

function makeSheet(name: string, rows: (string | null)[][]): SheetData {
  return { name, grid: rows }
}

// ── chiba: positional [相手, ○/×, 枚数], per-row 級 column (multi-class), no sub-header ──
const CHIBA_SHEET: SheetData = makeSheet('大会結果', [
  ['第1回テスト県大会', null, null, null, null, null, null, null, null, null],
  [null, null, null, '24', '人', null, null, null, null, null],
  [null, '氏名', '所属', '級', '1回戦', null, null, '2回戦', null, null],
  [null, '選手一郎', 'あ会', 'A', '選手二郎', '○', '21', '選手三郎', '○', '7'],
  [null, '選手二郎', 'い会', 'A', '選手一郎', '×', '21', null, null, null],
  [null, '選手三郎', 'う会', 'B', '不戦', '○', null, '選手二郎', '×', '7'],
])

describe('parseResultExcel — positional 回戦 layout (chiba: per-round triplet + 級 column)', () => {
  const classes = parseResultExcel([CHIBA_SHEET])

  it('groups participants into per-row 級 classes', () => {
    expect(classes.map((c) => c.className).sort()).toEqual(['A', 'B'])
    expect(classes.find((c) => c.className === 'A')?.grade).toBe('A')
    expect(classes.find((c) => c.className === 'B')?.grade).toBe('B')
  })

  it('parses [相手, ○, 枚数] triplets into matches', () => {
    const a = classes.find((c) => c.className === 'A')!
    const ichiro = a.participants.find((p) => p.name === '選手一郎')!
    expect(ichiro.affiliation).toBe('あ会')
    expect(ichiro.matches).toHaveLength(2)
    expect(ichiro.matches[0]).toMatchObject({ round: 1, result: 'win', scoreDiff: 21, opponentName: '選手二郎', status: 'normal' })
    expect(ichiro.matches[1]).toMatchObject({ round: 2, result: 'win', scoreDiff: 7, opponentName: '選手三郎' })
  })

  it('handles 不戦 in the opponent cell as a walkover win', () => {
    const b = classes.find((c) => c.className === 'B')!
    const saburo = b.participants.find((p) => p.name === '選手三郎')!
    expect(saburo.matches[0]).toMatchObject({ round: 1, result: 'win', status: 'walkover', opponentName: null, scoreDiff: null })
    expect(saburo.matches[1]).toMatchObject({ round: 2, result: 'lose', scoreDiff: 7, opponentName: '選手二郎' })
  })

  it('emits classes satisfying the ParsedClass schema', () => {
    for (const c of classes) expect(() => ParsedClassSchema.parse(c)).not.toThrow()
  })
})

// ── kuwana: split header (氏名 row, then 相手/勝敗 row); 勝敗 cell packs score "○11" ──
const KUWANA_SHEET: SheetData = makeSheet('Ａ級成績表', [
  ['第69回テスト大会結果表', null, null, null, null, null, null, null, null],
  [null, 'Ａ級', null, null, null, null, null, null, null],
  ['No', '氏名', '所属', '1回戦', null, '2回戦', null, '3回戦', null],
  [null, null, null, '相手', '勝敗', '相手', '勝敗', '相手', '勝敗'],
  ['1', '甲野選手', '甲会', '乙野選手', '○11', '丙野選手', '○16', '丁野選手', '×5'],
  ['2', '乙野選手', '乙会', '甲野選手', '×11', null, null, null, null],
])

describe('parseResultExcel — split header with score packed in 勝敗 (kuwana)', () => {
  const classes = parseResultExcel([KUWANA_SHEET])

  it('detects the layout despite 氏名 and 相手/勝敗 being on different rows', () => {
    expect(classes).toHaveLength(1)
    expect(classes[0]!.grade).toBe('A')
  })

  it('splits "○11" into result + score across all rounds incl. the last', () => {
    const kou = classes[0]!.participants.find((p) => p.name === '甲野選手')!
    expect(kou.matches).toHaveLength(3)
    expect(kou.matches[0]).toMatchObject({ round: 1, result: 'win', scoreDiff: 11, opponentName: '乙野選手' })
    expect(kou.matches[1]).toMatchObject({ round: 2, result: 'win', scoreDiff: 16, opponentName: '丙野選手' })
    expect(kou.matches[2]).toMatchObject({ round: 3, result: 'lose', scoreDiff: 5, opponentName: '丁野選手' })
  })
})

// ── ragged sub-header: the LAST round's 勝敗 label is missing, but the data has it ──
const RAGGED_SHEET: SheetData = makeSheet('Ｂ級成績表', [
  ['No', '氏名', '所属', '1回戦', null, '2回戦', null],
  [null, null, null, '相手', '勝敗', '相手'], // truncated: no 2回戦 勝敗 label
  ['1', '甲選手', '甲会', '乙選手', '○8', '丙選手', '○12'],
])

describe('parseResultExcel — ragged sub-header (last round 勝敗 label missing)', () => {
  it('reads the last round result via the positional fallback for that block', () => {
    const classes = parseResultExcel([RAGGED_SHEET])
    const kou = classes[0]!.participants.find((p) => p.name === '甲選手')!
    expect(kou.matches).toHaveLength(2)
    expect(kou.matches[1]).toMatchObject({ round: 2, result: 'win', scoreDiff: 12, opponentName: '丙選手' })
  })
})

// ── masuda: split header, 勝敗 cell "○＋５" (full-width plus + full-width digit) ──
const MASUDA_SHEET: SheetData = makeSheet('Sheet1', [
  ['第20回テスト大会　成績表', null, null, null, null, null, null, null],
  [null, 'Ｎｏ．', '氏名', '所属', '１回戦', null, '２回戦', null],
  [null, null, null, null, '相手', '勝敗', '相手', '勝敗'],
  [null, '1', '京野選手', '京会', '不戦勝', '○', '北村型', '○＋５'],
])

describe('parseResultExcel — full-width plus score (masuda: ○＋５)', () => {
  const classes = parseResultExcel([MASUDA_SHEET])

  it('parses 不戦勝 as walkover and "○＋５" as win by 5', () => {
    const p = classes[0]!.participants.find((x) => x.name === '京野選手')!
    expect(p.matches[0]).toMatchObject({ round: 1, result: 'win', status: 'walkover', opponentName: null })
    expect(p.matches[1]).toMatchObject({ round: 2, result: 'win', scoreDiff: 5, opponentName: '北村型' })
  })
})

// ── aux columns inside each block (№/級/所属) must be ignored via the sub-header ──
const AUX_COL_SHEET: SheetData = makeSheet('詳細結果', [
  [null, null, null, '１回戦', null, null, null, '２回戦', null, null, null],
  ['№', '氏名', '所属', '№', '対戦相手', '○✕', '枚数', '№', '対戦相手', '○✕', '枚数'],
  ['1', '安井選手', '祇園会', '25', '青木選手', '×', '13', '29', '河本選手', '○', '26'],
])

describe('parseResultExcel — aux columns ignored via sub-header (№/対戦相手/○✕/枚数)', () => {
  const classes = parseResultExcel([AUX_COL_SHEET])

  it('reads 対戦相手/○✕/枚数 and ignores the inner № column', () => {
    const p = classes[0]!.participants.find((x) => x.name === '安井選手')!
    expect(p.affiliation).toBe('祇園会')
    expect(p.matches).toHaveLength(2)
    // № (25/29) must NOT become the score or leak into the opponent name.
    expect(p.matches[0]).toMatchObject({ round: 1, result: 'lose', scoreDiff: 13, opponentName: '青木選手' })
    expect(p.matches[1]).toMatchObject({ round: 2, result: 'win', scoreDiff: 26, opponentName: '河本選手' })
  })
})

// ── newline in the 相手/勝敗 sub-header (kanagawa-style) must still be detected ──
const NEWLINE_SUBHEADER_SHEET: SheetData = makeSheet('対戦結果', [
  [null, null, null, '1回戦', null, null, '2回戦', null, null],
  [null, 'A', '氏名', '相\n手', '勝\n敗', '枚\n数', '相\n手', '勝\n敗', '枚\n数'],
  ['1', 'あ会', '走者選手', '不', '○', null, '渡辺型', '○', '4'],
])

describe('parseResultExcel — newline-split sub-header cells', () => {
  it('detects the round layout even when sub-header cells contain newlines', () => {
    const classes = parseResultExcel([NEWLINE_SUBHEADER_SHEET])
    expect(classes).toHaveLength(1)
    const p = classes[0]!.participants.find((x) => x.name === '走者選手')!
    expect(p).toBeTruthy()
    // round 2 = win by 4 vs 渡辺型 (round 1 "不" abbreviation may or may not resolve, not asserted)
    expect(p.matches.some((m) => m.opponentName === '渡辺型' && m.result === 'win' && m.scoreDiff === 4)).toBe(true)
  })
})

// ── name header on a row BELOW the 回戦 row (no sub-header) must not become a participant ──
describe('parseResultExcel — name-header row is not parsed as a participant', () => {
  const sheet = makeSheet('結果', [
    [null, null, null, '1回戦', null, null, '2回戦', null, null],
    ['No', '氏名', '所属', null, null, null, null, null, null],
    [null, '選手甲', '甲会', '選手乙', '○', '5', '選手丙', '○', '7'],
    [null, '選手乙', '乙会', '選手甲', '×', '5', null, null, null],
  ])
  const classes = parseResultExcel([sheet])

  it('skips the 氏名 header row and parses only real participants', () => {
    const names = classes.flatMap((c) => c.participants.map((p) => p.name))
    expect(names).not.toContain('氏名')
    expect(names).toContain('選手甲')
    const kou = classes[0]!.participants.find((p) => p.name === '選手甲')!
    expect(kou.matches[0]).toMatchObject({ round: 1, result: 'win', scoreDiff: 5, opponentName: '選手乙' })
  })
})

// ── single 回戦 positional layout (relaxed from the former ≥2 guard) ──
describe('parseResultExcel — single-round positional layout', () => {
  const sheet = makeSheet('E級結果', [
    [null, '氏名', '所属', '1回戦', null, null],
    [null, '単発甲', '甲会', '単発乙', '○', '8'],
    [null, '単発乙', '乙会', '単発甲', '×', '8'],
  ])
  it('parses a lone 1回戦 triplet', () => {
    const classes = parseResultExcel([sheet])
    expect(classes).toHaveLength(1)
    const kou = classes[0]!.participants.find((p) => p.name === '単発甲')!
    expect(kou.matches).toHaveLength(1)
    expect(kou.matches[0]).toMatchObject({ round: 1, result: 'win', scoreDiff: 8, opponentName: '単発乙' })
  })
})

// ── GUARDS: these must NOT be parsed by the fallback ──
describe('parseResultExcel — fallback guards (no false positives)', () => {
  it('does not parse a team-score table (チーム名, 回戦 numbers, no 氏名)', () => {
    const team = makeSheet('決勝順位表', [
      ['チーム名', '一回戦', '二回戦', '三回戦', '総勝点', '総勝数'],
      ['明治型大学', '5', '5', '5', '4', '20'],
      ['東京型庁', '5', '3', '5', '4', '16'],
    ])
    expect(parseResultExcel([team])).toEqual([])
  })

  it('does not parse a ranking summary (氏名 present but no 回戦)', () => {
    const rank = makeSheet('各級順位', [
      ['第三回テスト大会　各級順位', null, null, null, null],
      [null, null, '氏名', '所属会', '勝敗'],
      ['A級', '優勝', '田中型', 'X会', '３勝　０敗'],
    ])
    expect(parseResultExcel([rank])).toEqual([])
  })

  it('still routes a primary-detectable sheet through the primary path unchanged', () => {
    const primary = makeSheet('対戦結果表_C1級', [
      [null, null, null, '1回戦', null, null],
      ['No', '選手名', '所属', '相手', '枚数', '勝敗'],
      ['1', '主選手', 'X会', '相手選手', '8', '○'],
      ['2', '相手選手', 'Y会', '主選手', '8', '×'],
    ])
    const classes = parseResultExcel([primary])
    expect(classes).toHaveLength(1)
    expect(classes[0]!.className).toBe('C1')
    expect(classes[0]!.participants.find((p) => p.name === '主選手')!.matches[0]).toMatchObject({ result: 'win', scoreDiff: 8, opponentName: '相手選手' })
  })
})
