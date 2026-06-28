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
    expect(r.entries).toHaveLength(1)
  })

  it('氏名列がどのシートにも無ければ throw', () => {
    expect(() => parseRosterGrid([sheet([['日付', '会場'], ['1/1', '近江神宮']])])).toThrow(
      /氏名列/,
    )
  })
})
