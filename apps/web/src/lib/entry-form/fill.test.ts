import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it, expect } from 'vitest'
import { fillEntryForm, formatDan, type EntryFormConstants, type EntryFormMember } from './fill'
import type { CellMap } from './cell-map'

// vitest（jsdom 環境）では `import.meta.url` が file: スキームにならず
// `fileURLToPath` が throw する。cell-map.test.ts と同じ形で解決する。
const FIXTURE_DIR = resolve(process.cwd(), 'src/lib/entry-form/__fixtures__')

async function loadFixture(name: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await readFile(resolve(FIXTURE_DIR, name)))
  return wb
}

const NO_CONSTANTS: EntryFormConstants = {
  prefecture: null,
  clubName: null,
  managerName: null,
  phone: null,
  email: null,
  transferName: null,
}

function member(overrides: Partial<EntryFormMember>): EntryFormMember {
  return {
    grade: null,
    dan: null,
    familyName: null,
    givenName: null,
    familyKana: null,
    givenKana: null,
    appearanceCount: null,
    note: null,
    ...overrides,
  }
}

describe('formatDan', () => {
  it('null/0 は「無段」', () => {
    expect(formatDan(null, 'n段')).toBe('無段')
    expect(formatDan(0, 'n段')).toBe('無段')
    expect(formatDan(0, '漢数字')).toBe('無段')
  })

  it('n段形式: 1=初段、2以上=n段', () => {
    expect(formatDan(1, 'n段')).toBe('初段')
    expect(formatDan(3, 'n段')).toBe('3段')
    expect(formatDan(10, 'n段')).toBe('10段')
  })

  it('漢数字形式: 1=初、2以上=漢数字', () => {
    expect(formatDan(1, '漢数字')).toBe('初')
    expect(formatDan(3, '漢数字')).toBe('三')
    expect(formatDan(10, '漢数字')).toBe('十')
  })

  it('範囲外（11以上）は danFormat によらず数値そのままの n段 形式にフォールバックする', () => {
    expect(formatDan(11, 'n段')).toBe('11段')
    expect(formatDan(11, '漢数字')).toBe('11段')
  })
})

describe('fillEntryForm: standard.xlsx（標準型・単一シート）', () => {
  // cell-map.test.ts で検証済みの standard.xlsx 推定結果と同一の CellMap を手書きする
  // （fill 単体の検証としては手書きの方が明確なため）。
  const cellMap: CellMap = {
    sheets: [
      {
        sheetName: 'Sheet1',
        targetGrades: null,
        startRow: 12,
        columns: {
          grade: 'B',
          dan: 'E',
          familyName: 'F',
          givenName: 'G',
          fullKana: 'H',
          appearanceCount: 'I',
          note: 'J',
        },
        headerCells: {
          prefecture: 'F3',
          clubName: 'F4',
          managerName: 'F5',
          phone: 'F6',
          email: 'F7',
          transferName: 'F8',
        },
        danFormat: 'n段',
      },
    ],
  }

  it('3名を記入し、対象セルへ期待値が入る／数式セル・結合セル・入力規則が無傷', async () => {
    const workbook = await loadFixture('standard.xlsx')
    const originalMergeCount = workbook.worksheets[0]!.model.merges.length
    const originalDanChoices = workbook.worksheets[0]!.getCell('E12').dataValidation?.formulae

    const members: EntryFormMember[] = [
      member({ grade: 'A', dan: 1, familyName: '佐藤', givenName: '太郎' }),
      member({ grade: 'B', dan: null, familyName: '鈴木', givenName: '花子', appearanceCount: 3, note: '当日昇級' }),
      member({ grade: 'C', dan: 3, familyName: '高橋', givenName: '次郎', appearanceCount: 0 }),
    ]
    // このテンプレは fullKana（H列1列）にマップされる — 「姓かな＋名かな」を
    // 全角スペース結合した値が入る。
    members[0]!.familyKana = 'さとう'
    members[0]!.givenKana = 'たろう'
    members[1]!.familyKana = 'すずき'
    members[1]!.givenKana = 'はなこ'
    members[2]!.familyKana = 'たかはし'
    members[2]!.givenKana = 'じろう'

    const constants: EntryFormConstants = {
      ...NO_CONSTANTS,
      clubName: '北海道大学かるた会',
      managerName: '山田管理者',
    }

    const result = await fillEntryForm(workbook, cellMap, { members, constants })
    expect(result.unassignedMembers).toEqual([])
    expect(result.overflow).toEqual([])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const ws = reloaded.worksheets[0]!

    expect(ws.getCell('B12').value).toBe('A')
    expect(ws.getCell('E12').value).toBe('初段')
    expect(ws.getCell('F12').value).toBe('佐藤')
    expect(ws.getCell('G12').value).toBe('太郎')
    expect(ws.getCell('H12').value).toBe('さとう　たろう')

    expect(ws.getCell('B13').value).toBe('B')
    expect(ws.getCell('E13').value).toBe('無段') // dan: null
    expect(ws.getCell('I13').value).toBe(3)
    expect(ws.getCell('J13').value).toBe('当日昇級')

    expect(ws.getCell('B14').value).toBe('C')
    expect(ws.getCell('E14').value).toBe('3段')

    // 会定数（ヘッダ欄）
    expect(ws.getCell('F4').value).toBe('北海道大学かるた会')
    expect(ws.getCell('F5').value).toBe('山田管理者')

    // 数式セル（No 列）は上書きされない
    const a13 = ws.getCell('A13')
    expect(a13.type).toBe(ExcelJS.ValueType.Formula)
    expect(a13.formula).toBe('A12+1')
    const a14 = ws.getCell('A14')
    expect(a14.formula).toBe('A13+1')

    // 結合セル数が変わっていない
    expect(ws.model.merges.length).toBe(originalMergeCount)
    expect(originalMergeCount).toBe(6)

    // 入力規則（段位 DV の選択肢）が読める・変わっていない
    expect(ws.getCell('E12').dataValidation?.formulae).toEqual(originalDanChoices)
  })
})

describe('fillEntryForm: split-kana.xlsx（姓名・かな別列・漢数字段位・数式集計あり）', () => {
  const cellMap: CellMap = {
    sheets: [
      {
        sheetName: 'シニア選手権大会申込書',
        targetGrades: null,
        startRow: 7,
        columns: {
          familyName: 'B',
          givenName: 'C',
          familyKana: 'D',
          givenKana: 'E',
          dan: 'G',
          grade: 'H',
          note: 'J',
        },
        headerCells: {
          managerName: 'I1',
          transferName: 'I2',
        },
        danFormat: '漢数字',
      },
    ],
  }

  it('姓・名・かな姓・かな名が別セルに入り、段位が漢数字に整形され、I17の集計数式が無傷', async () => {
    const workbook = await loadFixture('split-kana.xlsx')

    const members: EntryFormMember[] = [
      member({
        grade: 'A',
        dan: 3,
        familyName: '伊藤',
        givenName: '一郎',
        familyKana: 'いとう',
        givenKana: 'いちろう',
      }),
    ]

    const result = await fillEntryForm(workbook, cellMap, { members, constants: NO_CONSTANTS })
    expect(result.unassignedMembers).toEqual([])
    expect(result.overflow).toEqual([])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const ws = reloaded.worksheets[0]!

    expect(ws.getCell('B7').value).toBe('伊藤')
    expect(ws.getCell('C7').value).toBe('一郎')
    expect(ws.getCell('D7').value).toBe('いとう')
    expect(ws.getCell('E7').value).toBe('いちろう')
    expect(ws.getCell('G7').value).toBe('三')
    expect(ws.getCell('H7').value).toBe('A')

    const i17 = ws.getCell('I17')
    expect(i17.type).toBe(ExcelJS.ValueType.Formula)
    expect(i17.formula).toBe('SUM(I7:I16)')

    expect(ws.model.merges.length).toBe(10)
  })
})

describe('fillEntryForm: shifted.xlsx（段位・出場回数列が無い変形型）', () => {
  const cellMap: CellMap = {
    sheets: [
      {
        sheetName: '申込書（D級の部）',
        targetGrades: ['D'],
        startRow: 13,
        columns: {
          grade: 'C',
          familyName: 'D',
          givenName: 'E',
          fullKana: 'F',
        },
        headerCells: {
          clubName: 'D4',
          managerName: 'D6',
          email: 'D7',
          phone: 'D8',
        },
        danFormat: 'n段',
      },
    ],
  }

  it('段位・出場回数の対応列が無いため書き込まず、級・姓・名・かなは正しいセルに入る', async () => {
    const workbook = await loadFixture('shifted.xlsx')

    const members: EntryFormMember[] = [
      member({
        grade: 'D',
        dan: 5, // 対応列が無いので書き込まれない
        appearanceCount: 10, // 同上
        familyName: '渡辺',
        givenName: '三郎',
        familyKana: 'わたなべ',
        givenKana: 'さぶろう',
      }),
    ]

    const result = await fillEntryForm(workbook, cellMap, { members, constants: NO_CONSTANTS })
    expect(result.unassignedMembers).toEqual([])
    expect(result.overflow).toEqual([])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const ws = reloaded.worksheets[0]!

    expect(ws.getCell('C13').value).toBe('D')
    expect(ws.getCell('D13').value).toBe('渡辺')
    expect(ws.getCell('E13').value).toBe('三郎')
    expect(ws.getCell('F13').value).toBe('わたなべ　さぶろう')

    // 対応列が無いフィールド（段位・出場回数）は何列にも書かれない。
    expect(ws.getCell('G13').value).toBeNull()
  })
})

describe('fillEntryForm: multisheet-grades.xlsx（級別複数シート型・AC-11）', () => {
  const cellMap: CellMap = {
    sheets: [
      {
        sheetName: 'C級',
        targetGrades: ['C'],
        startRow: 8,
        columns: {
          dan: 'B',
          familyName: 'C',
          givenName: 'D',
          familyKana: 'E',
          givenKana: 'F',
        },
        headerCells: {
          managerName: 'G3',
          phone: 'G4',
          email: 'G5',
        },
        danFormat: 'n段',
      },
      {
        sheetName: 'D級',
        targetGrades: ['D'],
        startRow: 8,
        columns: {
          dan: 'B',
          familyName: 'C',
          givenName: 'D',
          familyKana: 'E',
          givenKana: 'F',
        },
        headerCells: {
          managerName: 'G3',
          phone: 'G4',
          email: 'G5',
        },
        danFormat: 'n段',
      },
    ],
  }

  it('各会員が自分の級のシートにだけ記入され、他方へ漏れない／どのシートにも該当しない会員は unassignedMembers に載る', async () => {
    const workbook = await loadFixture('multisheet-grades.xlsx')

    const memberC = member({ grade: 'C', dan: 2, familyName: '木村', givenName: '一', familyKana: 'きむら', givenKana: 'はじめ' })
    const memberD = member({ grade: 'D', dan: 1, familyName: '林', givenName: '二', familyKana: 'はやし', givenKana: 'じ' })
    const memberE = member({ grade: 'E', dan: 1, familyName: '森', givenName: '三', familyKana: 'もり', givenKana: 'さん' })

    const result = await fillEntryForm(workbook, cellMap, {
      members: [memberC, memberD, memberE],
      constants: { ...NO_CONSTANTS, managerName: '責任者名' },
    })

    expect(result.overflow).toEqual([])
    expect(result.unassignedMembers).toEqual([memberE])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const cSheet = reloaded.getWorksheet('C級')!
    const dSheet = reloaded.getWorksheet('D級')!

    expect(cSheet.getCell('C8').value).toBe('木村')
    expect(cSheet.getCell('D8').value).toBe('一')
    // D級会員が C級シートへ漏れていない
    expect(cSheet.getCell('C9').value).toBeNull()

    expect(dSheet.getCell('C8').value).toBe('林')
    expect(dSheet.getCell('D8').value).toBe('二')
    // C級会員が D級シートへ漏れていない
    expect(dSheet.getCell('C9').value).toBeNull()

    // ヘッダ欄（会定数）は両シートに記入される
    expect(cSheet.getCell('G3').value).toBe('責任者名')
    expect(dSheet.getCell('G3').value).toBe('責任者名')
  })
})

describe('fillEntryForm: 数式セル未上書き', () => {
  it('マップ済み列（明細行）に数式がある行は、行ブロック判定（capacity）で最初から対象外になり、overflow として報告される', async () => {
    // standard.xlsx の E38〜E43（COUNTIF/SUM）は「dan 列（E）」＝マップ済み列に数式が
    // 乗っている実例。同じ状況を startRow 自体で再現する: computeCapacity は
    // マップ済み列のいずれかに既存値（数式含む）がある行を「使用不可」として弾くため、
    // この行は capacity=0 となり、writeMemberRow 自体が一度も呼ばれない
    // ——数式を書き込み側の判定に頼らず、行選定の時点で守られることを確認する。
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Sheet1')
    ws.getCell('B2').value = { formula: 'A2' } // dan 列（マップ済み）に数式が既にある

    const cellMap: CellMap = {
      sheets: [
        {
          sheetName: 'Sheet1',
          targetGrades: null,
          startRow: 2,
          columns: { familyName: 'A', dan: 'B' },
          headerCells: {},
          danFormat: 'n段',
        },
      ],
    }

    const members: EntryFormMember[] = [member({ familyName: '一名', dan: 3 })]

    const result = await fillEntryForm(workbook, cellMap, { members, constants: NO_CONSTANTS })
    // capacity=0 のため書き込まれず、overflow として報告される（沈黙の欠落にしない）。
    expect(result.overflow).toEqual([{ sheetName: 'Sheet1', members: [members[0]] }])
    expect(result.unassignedMembers).toEqual([])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const reloadedWs = reloaded.worksheets[0]!

    // 数式セルは無傷のまま、familyName も書き込まれていない（行ごと対象外）。
    const b2 = reloadedWs.getCell('B2')
    expect(b2.type).toBe(ExcelJS.ValueType.Formula)
    expect(b2.formula).toBe('A2')
    expect(reloadedWs.getCell('A2').value).toBeNull()
  })

  it('ヘッダ欄（headerCells）が数式セルを指していても書き込まない（capacity の対象外なので writeIfEditable 自体の防御が効く）', async () => {
    // headerCells は capacity/行ブロック判定を経由せず毎回無条件で書きに行くため、
    // 数式セル未上書きの防御はここでは writeIfEditable 内部のチェックだけが頼り。
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Sheet1')
    ws.getCell('C1').value = { formula: 'A1' } // 本来ラベルの隣にあるはずの入力欄が数式になっている異常系

    const cellMap: CellMap = {
      sheets: [
        {
          sheetName: 'Sheet1',
          targetGrades: null,
          startRow: 2,
          columns: {},
          headerCells: { managerName: 'C1' },
          danFormat: 'n段',
        },
      ],
    }

    const result = await fillEntryForm(workbook, cellMap, {
      members: [],
      constants: { ...NO_CONSTANTS, managerName: '山田管理者' },
    })
    expect(result.overflow).toEqual([])
    expect(result.unassignedMembers).toEqual([])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const c1 = reloaded.worksheets[0]!.getCell('C1')
    expect(c1.type).toBe(ExcelJS.ValueType.Formula)
    expect(c1.formula).toBe('A1')
  })
})

describe('fillEntryForm: 氏名結合型（columns.fullName）', () => {
  it('familyName + givenName を全角スペースで結合して1列に書く', async () => {
    // 現行 fixture はすべて姓名別列またはふりがな結合型で、fullName 結合型の実例が
    // 無いため最小構成で検証する（設計点10）。
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Sheet1')

    const cellMap: CellMap = {
      sheets: [
        {
          sheetName: 'Sheet1',
          targetGrades: null,
          startRow: 2,
          columns: { fullName: 'A' },
          headerCells: {},
          danFormat: 'n段',
        },
      ],
    }

    const members: EntryFormMember[] = [
      member({ familyName: '山田', givenName: '太郎' }),
      member({ familyName: '鈴木', givenName: null }), // 片方欠損時は詰めて1語にする
    ]

    const result = await fillEntryForm(workbook, cellMap, { members, constants: NO_CONSTANTS })
    expect(result.overflow).toEqual([])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const ws = reloaded.worksheets[0]!
    expect(ws.getCell('A2').value).toBe('山田　太郎')
    expect(ws.getCell('A3').value).toBe('鈴木')
  })
})

describe('fillEntryForm: 行数超過（overflow）', () => {
  it('シートの用意された行数を超えた分は行を追加せず overflow として返す', async () => {
    // 実物 fixture は用意行数が20〜40行と広く決定的な超過を作りにくいため、
    // 容量が明確な最小構成のワークブックを組み立てて検証する（設計点11）。
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Sheet1')
    ws.getCell('A1').value = '参加級'
    ws.getCell('B1').value = '氏名'
    // A2, A3 が記入可能行（容量2）。A4 に既存ラベルを置き、それ以降を「使用中」として塞ぐ。
    ws.getCell('A4').value = '合計'

    const cellMap: CellMap = {
      sheets: [
        {
          sheetName: 'Sheet1',
          targetGrades: null,
          startRow: 2,
          columns: { grade: 'A', familyName: 'B' },
          headerCells: {},
          danFormat: 'n段',
        },
      ],
    }

    const members: EntryFormMember[] = [
      member({ grade: 'A', familyName: '一名' }),
      member({ grade: 'B', familyName: '二名' }),
      member({ grade: 'C', familyName: '三名' }),
    ]

    const result = await fillEntryForm(workbook, cellMap, { members, constants: NO_CONSTANTS })

    expect(result.unassignedMembers).toEqual([])
    expect(result.overflow).toEqual([{ sheetName: 'Sheet1', members: [members[2]] }])

    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(result.buffer)
    const reloadedWs = reloaded.worksheets[0]!
    expect(reloadedWs.getCell('B2').value).toBe('一名')
    expect(reloadedWs.getCell('B3').value).toBe('二名')
    // 3人目は書き込まれず、既存の「合計」ラベル行も破壊されない。
    expect(reloadedWs.getCell('A4').value).toBe('合計')
  })
})
