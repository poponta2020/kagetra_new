import { describe, it, expect } from 'vitest'
import type { CellMapSheet, CellMap } from '@/lib/entry-form/cell-map'
import type { Grade } from '@kagetra/shared/types'
import {
  applyColumnChange,
  applyTargetGradesChange,
  buildMappingRows,
  hasUnresolvedSheetGrades,
  removeSheet,
} from './cell-map-view'

function sheet(overrides: Partial<CellMapSheet> = {}): CellMapSheet {
  return {
    sheetName: 'Sheet1',
    targetGrades: null,
    startRow: 12,
    columns: {},
    headerCells: {},
    danFormat: 'n段',
    ...overrides,
  }
}

describe('buildMappingRows', () => {
  it('姓/名が分かれている標準テンプレ（b-step1.html）', () => {
    const rows = buildMappingRows(
      sheet({
        columns: {
          grade: 'B',
          dan: 'E',
          familyName: 'F',
          givenName: 'G',
          fullKana: 'H',
          appearanceCount: 'I',
          note: 'J',
        },
      }),
    )
    expect(rows.map((r) => [r.field, r.column])).toEqual([
      ['grade', 'B'],
      ['dan', 'E'],
      ['familyName', 'F'],
      ['givenName', 'G'],
      ['fullKana', 'H'],
      ['appearanceCount', 'I'],
      ['note', 'J'],
    ])
    const kanaRow = rows.find((r) => r.field === 'fullKana')
    expect(kanaRow?.note).toBe('（姓名まとめて）')
  })

  it('氏名・ふりがなが結合列のテンプレ（b-step1-multisheet.html）', () => {
    const rows = buildMappingRows(sheet({ columns: { fullName: 'E', fullKana: 'F' } }))
    const nameRow = rows.find((r) => r.field === 'fullName')
    expect(nameRow).toEqual({ field: 'fullName', label: '氏名', column: 'E', note: '（姓名まとめて）' })
  })

  it('対応する列が無いフィールドは column: null になる（対応なし表示の判定に使う）', () => {
    const rows = buildMappingRows(sheet({ columns: { grade: 'B' } }))
    const dan = rows.find((r) => r.field === 'dan')
    expect(dan?.column).toBeNull()
    const name = rows.find((r) => r.field === 'fullName')
    expect(name?.column).toBeNull()
  })

  it('段位の対応がある場合のみ danFormat の注記を出す', () => {
    const withDan = buildMappingRows(sheet({ columns: { dan: 'D' }, danFormat: '漢数字' }))
    expect(withDan.find((r) => r.field === 'dan')?.note).toBe('（漢数字形式）')

    const withoutDan = buildMappingRows(sheet({ columns: {} }))
    expect(withoutDan.find((r) => r.field === 'dan')?.note).toBeNull()
  })
})

describe('applyColumnChange', () => {
  it('指定したシート・フィールドの列だけを書き換える', () => {
    const cellMap: CellMap = { sheets: [sheet({ columns: { grade: 'B' } }), sheet({ sheetName: 'Sheet2' })] }
    const updated = applyColumnChange(cellMap, 0, 'grade', 'C')
    expect(updated.sheets[0]?.columns.grade).toBe('C')
    expect(updated.sheets[1]?.columns.grade).toBeUndefined()
    // 元オブジェクトは変更しない(イミュータブル)
    expect(cellMap.sheets[0]?.columns.grade).toBe('B')
  })

  it('value が null/空文字ならキー自体を削除する（対応なしに戻す）', () => {
    const cellMap: CellMap = { sheets: [sheet({ columns: { note: 'J' } })] }
    const updated = applyColumnChange(cellMap, 0, 'note', null)
    expect(updated.sheets[0]?.columns.note).toBeUndefined()
  })
})

describe('hasUnresolvedSheetGrades — 全シート重複記入の防止', () => {
  const namedSheet = (name: string, targetGrades: Grade[] | null): CellMapSheet => ({
    sheetName: name,
    targetGrades,
    startRow: 8,
    columns: { familyName: 'C', givenName: 'D' },
    headerCells: {},
    danFormat: 'n段',
  })

  it('単一シートの targetGrades=null は「全会員をこのシートへ」で正常', () => {
    expect(hasUnresolvedSheetGrades({ sheets: [namedSheet('Sheet1', null)] })).toBe(false)
  })

  it('複数シートで targetGrades=null が残っていると未解決', () => {
    // このまま作成すると fillEntryForm が null を「全会員」と解釈し、
    // 全員が両シートへ重複記入される。
    expect(
      hasUnresolvedSheetGrades({ sheets: [namedSheet('上級', null), namedSheet('中級', null)] }),
    ).toBe(true)
  })

  it('複数シートでも全シートの級が決まっていれば解決済み', () => {
    expect(
      hasUnresolvedSheetGrades({ sheets: [namedSheet('C級', ['C']), namedSheet('D級', ['D'])] }),
    ).toBe(false)
  })

  it('applyTargetGradesChange で級を指定でき、removeSheet で対象から外せる', () => {
    const cellMap = { sheets: [namedSheet('上級', null), namedSheet('中級', null)] }
    expect(applyTargetGradesChange(cellMap, 0, ['A']).sheets[0]!.targetGrades).toEqual(['A'])
    expect(removeSheet(cellMap, 1).sheets).toHaveLength(1)
  })
})
