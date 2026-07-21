import { describe, expect, it } from 'vitest'
import { parseRosterGrid } from './parser'
import type { SheetData } from '@kagetra/mail-worker/result-import/reader'

function sheet(grid: (string | null)[][], name = 'Sheet1'): SheetData {
  return { name, grid }
}

describe('parseRosterGrid', () => {
  it('氏名/ふりがな/級/所属/№ を列検出して各行を抽出', () => {
    const r = parseRosterGrid([
      sheet([
        ['№', '氏名', 'ふりがな', '級', '所属'],
        ['1', '札幌太郎', 'さっぽろたろう', 'A', '札幌かるた会'],
        ['2', '函館花子', 'はこだてはなこ', 'B級', '函館'],
      ]),
    ])
    expect(r.entries).toHaveLength(2)
    expect(r.entries[0]).toMatchObject({
      rawName: '札幌太郎',
      rawKana: 'さっぽろたろう',
      grade: 'A',
      rawAffiliation: '札幌かるた会',
      seqNo: 1,
    })
    // 'B級' → B、全角級も NFKC で拾う
    expect(r.entries[1]?.grade).toBe('B')
  })

  it('姓+名 が別列なら連結する', () => {
    const r = parseRosterGrid([
      sheet([
        ['姓', '名', '級'],
        ['札幌', '太郎', 'C'],
      ]),
    ])
    expect(r.entries[0]?.rawName).toBe('札幌太郎')
    expect(r.entries[0]?.grade).toBe('C')
  })

  it('「会名」は所属に分類し、氏名の「名」列に誤分類しない（Codex R1 should_fix）', () => {
    const r = parseRosterGrid([
      sheet([
        ['氏名', '会名', '級'],
        ['札幌太郎', '札幌かるた会', 'A'],
      ]),
    ])
    expect(r.entries[0]?.rawName).toBe('札幌太郎')
    expect(r.entries[0]?.rawAffiliation).toBe('札幌かるた会')
  })

  it('姓+名+会名 形式（「名」単独列だけが firstName）', () => {
    const r = parseRosterGrid([
      sheet([
        ['姓', '名', '会名'],
        ['札幌', '太郎', '札幌会'],
      ]),
    ])
    expect(r.entries[0]?.rawName).toBe('札幌太郎')
    expect(r.entries[0]?.rawAffiliation).toBe('札幌会')
  })

  it('空行・氏名なし行はスキップする', () => {
    const r = parseRosterGrid([
      sheet([
        ['氏名', '級'],
        ['札幌太郎', 'A'],
        ['', ''],
        [null, 'B'],
        ['小計', ''],
        ['函館花子', 'D'],
      ]),
    ])
    // '小計' は氏名列に値があるので拾われる点に注意 → このテストでは実データ的に
    // 氏名のある行が 3 件（札幌太郎・小計・函館花子）になる。空/null 行のみスキップを確認。
    expect(r.entries.map((e) => e.rawName)).toEqual(['札幌太郎', '小計', '函館花子'])
  })

  it('状態列は statusText に入る', () => {
    const r = parseRosterGrid([
      sheet([
        ['氏名', '区分'],
        ['札幌太郎', '確定'],
        ['函館花子', '繰上'],
      ]),
    ])
    expect(r.entries[0]?.statusText).toBe('確定')
    expect(r.entries[1]?.statusText).toBe('繰上')
  })

  it('ヘッダが先頭でなく途中にあっても検出する', () => {
    const r = parseRosterGrid([
      sheet([
        ['第10回 ○○大会 確定名簿'],
        ['発行日 2026-01-01'],
        ['氏名', '級'],
        ['札幌太郎', 'A'],
      ]),
    ])
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0]?.rawName).toBe('札幌太郎')
  })

  it('氏名列を持つシートを優先採用する（先頭シートに無くても）', () => {
    const r = parseRosterGrid([
      sheet([['注意事項'], ['※持ち物']], '表紙'),
      sheet(
        [
          ['氏名', '級'],
          ['札幌太郎', 'A'],
        ],
        '名簿',
      ),
    ])
    expect(r.sheetName).toBe('名簿')
    expect(r.sheetNames).toEqual(['名簿'])
    expect(r.entries).toHaveLength(1)
  })

  it('氏名表を持つ全シートを結合し、シート名から A〜E 級を補う', () => {
    const r = parseRosterGrid([
      sheet([['注意事項'], ['持ち物']], '表紙'),
      ...(['A', 'B', 'C', 'D', 'E'] as const).map((grade) =>
        sheet([['氏名'], [`${grade}級選手`]], `${grade}級`),
      ),
    ])

    expect(r.sheetNames).toEqual(['A級', 'B級', 'C級', 'D級', 'E級'])
    expect(r.entries.map((entry) => entry.grade)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('当落区分・抽選除外を保持し、自己申告の出場回数は状態へ流用しない', () => {
    const r = parseRosterGrid([
      sheet(
        [
          ['氏名', '当落', '抽選除外', '出場回数'],
          ['当選太郎', '当選', '○', '5'],
          ['待機花子', 'キャンセル待ち', '対象外', '0'],
          ['落選次郎', '落選', '', '2'],
        ],
        'A級抽選結果',
      ),
    ])

    expect(r.entries.map((entry) => entry.selectionOutcome)).toEqual([
      'accepted',
      'waitlisted',
      'rejected',
    ])
    expect(r.entries.map((entry) => entry.selectionExempt)).toEqual([true, false, false])
    expect(r.entries.every((entry) => entry.statusText === null)).toBe(true)
  })

  it('同一級の正規化氏名重複は自動除外せず検証エラーにする', () => {
    expect(() =>
      parseRosterGrid([
        sheet([['氏名'], ['山田 太郎']], 'A級当選'),
        sheet([['氏名'], ['山田太郎']], 'A級キャンセル待ち'),
      ]),
    ).toThrow(/同一級に重複/)
  })

  it('氏名列がどのシートにも無ければ throw', () => {
    expect(() => parseRosterGrid([sheet([['日付', '会場'], ['1/1', '近江神宮']])])).toThrow(
      /氏名列/,
    )
  })
})
