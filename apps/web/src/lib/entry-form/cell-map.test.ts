import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it, expect } from 'vitest'
import { estimateCellMap } from './cell-map'
import { loadWorkbook } from './workbook'

// vitest（jsdom 環境）では `import.meta.url` が file: スキームにならず
// `fileURLToPath` が throw する。web の vitest は root = apps/web で走るので
// リポジトリ相対で解決する。
const FIXTURE_DIR = resolve(process.cwd(), 'src/lib/entry-form/__fixtures__')

async function loadFixture(name: string): Promise<ExcelJS.Workbook> {
  return loadWorkbook(await readFile(resolve(FIXTURE_DIR, name)))
}

describe('estimateCellMap', () => {
  // 標準型: ヘッダ欄 A3〜A8（結合入力欄 F3:G3〜F8:G8）・明細ヘッダ r11・記入開始 r12・
  // 段位 DV「初段,2段,…」・No 列（数式セル）は対象外・申込先メールが本文セルに直書き。
  it('standard.xlsx: 列対応・開始行・ヘッダ欄・段位形式・申込先を正しく推定する', async () => {
    const result = estimateCellMap(await loadFixture('standard.xlsx'))

    expect(result.confidence).toBe('high')
    expect(result.warnings).toEqual([])
    expect(result.organizerEmail).toBe('entry@example.invalid')
    expect(result.sheets).toHaveLength(1)

    const sheet = result.sheets[0]!
    expect(sheet.sheetName).toBe('Sheet1')
    expect(sheet.targetGrades).toBeNull() // 単一シートで全級を扱う（DV の5択は narrowing にならない）
    expect(sheet.startRow).toBe(12)
    expect(sheet.danFormat).toBe('n段')
    expect(sheet.columns).toEqual({
      grade: 'B',
      dan: 'E',
      familyName: 'F',
      givenName: 'G',
      fullKana: 'H',
      appearanceCount: 'I',
      note: 'J',
    })
    // No 列（A11, 数式 =A12+1 が並ぶ）はマップ対象に含まれないことを保証する。
    expect(sheet.columns).not.toHaveProperty('no')
    expect(sheet.headerCells).toEqual({
      prefecture: 'F3',
      clubName: 'F4',
      managerName: 'F5',
      phone: 'F6',
      email: 'F7',
      transferName: 'F8',
    })
  })

  // 姓名・かなが別列の2段ヘッダ型: 上段(氏名/ふりがな)と下段(姓/名)の2行ヘッダから
  // 下段を実ヘッダ行として選び、上段の文脈で familyKana/givenKana を判別する。
  // 段位 DV は漢数字。申込責任者・振込名義人の結合入力欄(I1/I2)を持つ。
  it('split-kana.xlsx: 2段ヘッダから姓名・ふりがなを列ごとに分離し、段位形式を漢数字と判定する', async () => {
    const result = estimateCellMap(await loadFixture('split-kana.xlsx'))

    expect(result.confidence).toBe('high')
    expect(result.warnings).toEqual([])
    expect(result.organizerEmail).toBe('entry@example.invalid')
    expect(result.sheets).toHaveLength(1)

    const sheet = result.sheets[0]!
    expect(sheet.sheetName).toBe('シニア選手権大会申込書')
    expect(sheet.targetGrades).toBeNull()
    expect(sheet.startRow).toBe(7)
    expect(sheet.danFormat).toBe('漢数字')
    expect(sheet.columns).toEqual({
      familyName: 'B',
      givenName: 'C',
      familyKana: 'D',
      givenKana: 'E',
      dan: 'G',
      grade: 'H',
      note: 'J',
    })
    expect(sheet.headerCells).toEqual({
      managerName: 'I1',
      transferName: 'I2',
    })
  })

  // 変形型: 段位列・出場回数列が無い。参加級 DV が "D" 固定でシート名からも
  // D級と分かる（2つの独立シグナルが一致）。ヘッダ欄ラベルが全角コロン付き語形
  // （「所属会名：」等）で都道府県・振込名義人の欄が無い。参加資格事由(H)列は非対象。
  it('shifted.xlsx: 段位/出場回数列の欠落を空欄のまま扱い、DVとシート名の両方から対象級Dを推定する', async () => {
    const result = estimateCellMap(await loadFixture('shifted.xlsx'))

    expect(result.confidence).toBe('high')
    expect(result.warnings).toEqual([])
    expect(result.organizerEmail).toBe('entry@example.invalid')
    expect(result.sheets).toHaveLength(1)

    const sheet = result.sheets[0]!
    expect(sheet.sheetName).toBe('申込書（D級の部）')
    expect(sheet.targetGrades).toEqual(['D'])
    expect(sheet.startRow).toBe(13)
    expect(sheet.danFormat).toBe('n段') // 段位 DV が無いテンプレの既定値
    expect(sheet.columns).toEqual({
      grade: 'C',
      familyName: 'D',
      givenName: 'E',
      fullKana: 'F',
    })
    expect(sheet.headerCells).toEqual({
      clubName: 'D4',
      managerName: 'D6',
      email: 'D7',
      phone: 'D8',
    })
  })

  // 級別複数シート型（鳳玉型）: シート名 C級/D級 から各シートの対象級を判定し、
  // 全会員を該当シートへ振り分けられる状態にする（AC-11）。
  it('multisheet-grades.xlsx: シート名から対象級を判定し、全シートが高信頼で記入対象になる', async () => {
    const result = estimateCellMap(await loadFixture('multisheet-grades.xlsx'))

    expect(result.confidence).toBe('high')
    expect(result.warnings).toEqual([])
    expect(result.organizerEmail).toBeNull() // このテンプレにメールアドレスは存在しない
    expect(result.sheets).toHaveLength(2)

    const [cGrade, dGrade] = result.sheets
    expect(cGrade!.sheetName).toBe('C級')
    expect(cGrade!.targetGrades).toEqual(['C'])
    expect(dGrade!.sheetName).toBe('D級')
    expect(dGrade!.targetGrades).toEqual(['D'])

    for (const sheet of result.sheets) {
      expect(sheet.startRow).toBe(8)
      expect(sheet.danFormat).toBe('n段')
      expect(sheet.columns).toEqual({
        dan: 'B',
        familyName: 'C',
        givenName: 'D',
        familyKana: 'E',
        givenKana: 'F',
      })
      // 所属会（学校名）列はマップ対象外（空欄のまま手入力させる）。
      expect(sheet.columns).not.toHaveProperty('note')
      expect(sheet.headerCells).toEqual({
        managerName: 'G3',
        phone: 'G4',
        email: 'G5',
      })
    }
  })

  // multisheet-grades.xlsx と同一構造でシート名だけ「上級」「中級」。A〜E 級へ機械的に
  // 対応させられないため低信頼を返し、AI フォールバック／手動マッピングへ回す（AC-7 の入口）。
  it('multisheet-ambiguous.xlsx: 非標準のシート名では対象級を特定できず低信頼を返す', async () => {
    const result = estimateCellMap(await loadFixture('multisheet-ambiguous.xlsx'))

    expect(result.confidence).toBe('low')
    expect(result.warnings).toEqual([
      '複数シートですが、シート名などから対象級を特定できないシートがあります',
    ])
    expect(result.organizerEmail).toBeNull()
    expect(result.sheets).toHaveLength(2)
    expect(result.sheets[0]!.sheetName).toBe('上級')
    expect(result.sheets[0]!.targetGrades).toBeNull()
    expect(result.sheets[1]!.sheetName).toBe('中級')
    expect(result.sheets[1]!.targetGrades).toBeNull()
  })
})
