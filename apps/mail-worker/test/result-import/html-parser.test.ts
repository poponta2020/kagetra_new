/**
 * Unit tests for parseResultHtml — the HTML result-table parser (W1).
 *
 * Fixtures are hand-crafted HTML strings that mirror the real
 * `table.tournament_tree` structure of the harvested member pages (real files
 * contain player names and are git-external). Each fixture reproduces a
 * structural variant observed in the corpus, including the broken 不戦 (bye)
 * markup where a result_cell closes early and a class-less <td> follows.
 */

import { describe, expect, it } from 'vitest'
import { ParsedClassSchema } from '../../src/result-import/schema.js'
import { parseResultHtml } from '../../src/result-import/html-parser.js'

/** Build a minimal but faithful result page. `rows` are raw <tr> inner HTML. */
function buildPage(opts: {
  title: string
  date: string // e.g. '2017年05月21日'
  klass: string
  headers: string[] // round labels, e.g. ['1回戦', '2回戦']
  rows: string[]
}): string {
  const ths = ['<th>選手名</th>', ...opts.headers.map((h) => `<th>${h}</th>`)].join('')
  return `<!DOCTYPE html><html><head>
<meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body>
<div style="text-align:center;margin-top:10px;"><h2>${opts.title}</h2>(${opts.date})</div>
<div class="TabbedPanels" id="tp1">
  <ul class="TabbedPanelsTabGroup">
    <li class="TabbedPanelsTab"><a href="../prize_winners.html">入賞者</a></li>
    <li class="TabbedPanelsTabSelected">${opts.klass}</li>
    <li class="TabbedPanelsTab"><a href="x.html">別級</a></li>
  </ul>
  <div class="TabbedPanelsContentGroup"><div class="TabbedPanelsContent">
    <div id="tournament_tree">
      <table class="tournament_tree">
        <tr>${ths}</tr>
        ${opts.rows.join('\n')}
      </table>
    </div>
  </div></div>
</div></body></html>`
}

describe('parseResultHtml — standard page', () => {
  const html = buildPage({
    title: '第99回テスト選手権大会',
    date: '2017年05月21日',
    klass: 'A',
    headers: ['1回戦', '2回戦'],
    rows: [
      `<tr>
        <td class="result_cell">テスト一郎<br/>（東京かるた会）</td>
        <td class="result_cell">\n○\n4\nテスト二郎\n</td>
        <td class="result_cell">\n○\n6\nテスト三郎\n</td>
      </tr>`,
      `<tr>
        <td class="result_cell">テスト二郎<br/>（大阪かるた会）</td>
        <td class="result_cell">\n×\n4\nテスト一郎\n</td>
      </tr>`,
    ],
  })
  const result = parseResultHtml(html)

  it('extracts tournament name from <h2>', () => {
    expect(result.tournamentName).toBe('第99回テスト選手権大会')
  })

  it('extracts event date as YYYY-MM-DD from the heading', () => {
    expect(result.eventDate).toBe('2017-05-21')
  })

  it('produces one class with className/grade from the selected tab', () => {
    expect(result.classes).toHaveLength(1)
    expect(result.classes[0]?.className).toBe('A')
    expect(result.classes[0]?.grade).toBe('A')
    expect(result.classes[0]?.sheetName).toBeNull()
  })

  it('parses participants with name + affiliation', () => {
    const p = result.classes[0]!.participants
    expect(p).toHaveLength(2)
    const ichiro = p.find((x) => x.name === 'テスト一郎')!
    expect(ichiro.affiliation).toBe('東京かるた会')
    expect(ichiro.nameKana).toBeNull()
    expect(ichiro.seqNo).toBeNull()
  })

  it('parses each round into win/lose with score, opponent, round number, label', () => {
    const ichiro = result.classes[0]!.participants.find((x) => x.name === 'テスト一郎')!
    expect(ichiro.matches).toHaveLength(2)
    expect(ichiro.matches[0]).toMatchObject({
      round: 1,
      roundLabel: '1回戦',
      result: 'win',
      scoreDiff: 4,
      opponentName: 'テスト二郎',
      status: 'normal',
    })
    expect(ichiro.matches[1]).toMatchObject({
      round: 2,
      roundLabel: '2回戦',
      result: 'win',
      scoreDiff: 6,
      opponentName: 'テスト三郎',
    })
  })

  it('records the eliminated player with a single lose match', () => {
    const jiro = result.classes[0]!.participants.find((x) => x.name === 'テスト二郎')!
    expect(jiro.matches).toHaveLength(1)
    expect(jiro.matches[0]).toMatchObject({ round: 1, result: 'lose', opponentName: 'テスト一郎' })
  })

  it('keeps own-name and opponent-name in the same representation (for materialize dedup)', () => {
    const jiro = result.classes[0]!.participants.find((x) => x.name === 'テスト二郎')!
    const ichiroOpponent = result.classes[0]!.participants.find((x) => x.name === 'テスト一郎')!
      .matches[0]!.opponentName
    expect(ichiroOpponent).toBe(jiro.name)
  })

  it('emits classes that satisfy the ParsedClass zod schema', () => {
    for (const c of result.classes) {
      expect(() => ParsedClassSchema.parse(c)).not.toThrow()
    }
  })
})

describe('parseResultHtml — 不戦 (bye) with broken markup', () => {
  // The real source closes the result_cell after 不戦 and opens a class-less <td>
  // for the next round. Iterating ALL <td> keeps rounds aligned.
  const html = buildPage({
    title: 'テストシニア大会',
    date: '2017年05月21日',
    klass: 'G（シニア）',
    headers: ['1回戦', '2回戦'],
    rows: [
      `<tr>
        <td class="result_cell">バイ太郎<br/>（北海道かるた会）</td>
        <td class="result_cell">\n不戦</td><td>\n○\n1\n相手次郎\n</td>
      </tr>`,
    ],
  })
  const result = parseResultHtml(html)

  it('derives grade null for a non A–E class but keeps the className (NFKC-folded)', () => {
    // normalizeText applies NFKC, folding full-width 「（）」 to half-width, same as
    // the Excel path normalizes class names.
    expect(result.classes[0]?.className).toBe('G(シニア)')
    expect(result.classes[0]?.grade).toBeNull()
  })

  it('treats the 不戦 cell as round 1 walkover win (no opponent/score)', () => {
    const p = result.classes[0]!.participants.find((x) => x.name === 'バイ太郎')!
    expect(p.matches[0]).toMatchObject({
      round: 1,
      roundLabel: '1回戦',
      result: 'win',
      status: 'walkover',
      opponentName: null,
      scoreDiff: null,
    })
  })

  it('keeps the following class-less <td> as round 2 (no misalignment)', () => {
    const p = result.classes[0]!.participants.find((x) => x.name === 'バイ太郎')!
    expect(p.matches).toHaveLength(2)
    expect(p.matches[1]).toMatchObject({
      round: 2,
      roundLabel: '2回戦',
      result: 'win',
      scoreDiff: 1,
      opponentName: '相手次郎',
      status: 'normal',
    })
  })
})

describe('parseResultHtml — edge cases', () => {
  it('returns no classes for a results-not-entered page (header only)', () => {
    const html = buildPage({
      title: '未入力大会',
      date: '2018年01月07日',
      klass: 'C1',
      headers: [],
      rows: [],
    })
    const result = parseResultHtml(html)
    expect(result.classes).toHaveLength(0)
    expect(result.tournamentName).toBe('未入力大会')
    expect(result.eventDate).toBe('2018-01-07')
  })

  it('zero-pads single-digit month/day from the heading', () => {
    const html = buildPage({
      title: 'パディング大会',
      date: '2019年2月3日',
      klass: 'B',
      headers: ['1回戦'],
      rows: [
        `<tr><td class="result_cell">選手甲<br/>（甲会）</td><td class="result_cell">○ 7 選手乙</td></tr>`,
      ],
    })
    expect(parseResultHtml(html).eventDate).toBe('2019-02-03')
  })

  it('returns empty classes (not a throw) when there is no result table', () => {
    const result = parseResultHtml('<html><body><h2>無表大会</h2>(2020年03月03日)</body></html>')
    expect(result.classes).toEqual([])
    expect(result.tournamentName).toBe('無表大会')
  })

  it('parses a player whose name cell has no affiliation', () => {
    const html = buildPage({
      title: '所属なし大会',
      date: '2017年09月09日',
      klass: 'D1',
      headers: ['1回戦'],
      rows: [
        `<tr><td class="result_cell">無所属太郎</td><td class="result_cell">× 2 相手</td></tr>`,
      ],
    })
    const p = parseResultHtml(html).classes[0]!.participants[0]!
    expect(p.name).toBe('無所属太郎')
    expect(p.affiliation).toBeNull()
  })
})
