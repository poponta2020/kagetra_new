import type { CellMap, CellMapSheet, MemberField } from '@/lib/entry-form/cell-map'

/**
 * entry-form-autofill タスク7 (UI): ステップ1「列の対応」表示用の純ロジック。
 * `CellMapSheet.columns` は「対応できたフィールドだけキーを持つ」形なので、
 * 型だけ import して（`import type` — cell-map.ts は変更禁止・server-only）
 * ここで「対応なし」行を含む固定順のビューへ組み立て直す。
 *
 * 注意: DV（入力規則）の選択肢文言（例: 「A級〜E級のリスト入力」）は `CellMap` に
 * 含まれておらず復元できない。ここで出す `note` は構造的に判別できる情報
 * （姓名/ふりがな結合・段位のフォーマット）だけに限る。
 */
export interface MappingRow {
  field: MemberField
  label: string
  column: string | null
  note: string | null
}

export const FIELD_LABELS: Record<MemberField, string> = {
  grade: '参加級',
  dan: '段位',
  familyName: '姓',
  givenName: '名',
  fullName: '氏名',
  familyKana: 'ふりがな（姓）',
  givenKana: 'ふりがな（名）',
  fullKana: 'ふりがな',
  appearanceCount: '出場回数',
  note: '備考',
}

/**
 * 1シート分の「列の対応」行を組み立てる。姓名・ふりがなは結合列（fullName/fullKana）が
 * あればそちらを1行、無ければ姓/名（ふりがな姓/名）を2行に分けて出す
 * ——どちらの形式でテンプレが組まれているかは `cell-map.ts` の推定結果からしか分からない。
 */
export function buildMappingRows(sheet: CellMapSheet): MappingRow[] {
  const rows: MappingRow[] = []

  rows.push({ field: 'grade', label: FIELD_LABELS.grade, column: sheet.columns.grade ?? null, note: null })
  rows.push({
    field: 'dan',
    label: FIELD_LABELS.dan,
    column: sheet.columns.dan ?? null,
    note: sheet.columns.dan ? `（${sheet.danFormat}形式）` : null,
  })

  if (sheet.columns.fullName) {
    rows.push({ field: 'fullName', label: '氏名', column: sheet.columns.fullName, note: '（姓名まとめて）' })
  } else if (sheet.columns.familyName || sheet.columns.givenName) {
    rows.push({
      field: 'familyName',
      label: FIELD_LABELS.familyName,
      column: sheet.columns.familyName ?? null,
      note: null,
    })
    rows.push({
      field: 'givenName',
      label: FIELD_LABELS.givenName,
      column: sheet.columns.givenName ?? null,
      note: null,
    })
  } else {
    rows.push({ field: 'fullName', label: '氏名', column: null, note: null })
  }

  if (sheet.columns.fullKana) {
    rows.push({ field: 'fullKana', label: 'ふりがな', column: sheet.columns.fullKana, note: '（姓名まとめて）' })
  } else if (sheet.columns.familyKana || sheet.columns.givenKana) {
    rows.push({
      field: 'familyKana',
      label: FIELD_LABELS.familyKana,
      column: sheet.columns.familyKana ?? null,
      note: null,
    })
    rows.push({
      field: 'givenKana',
      label: FIELD_LABELS.givenKana,
      column: sheet.columns.givenKana ?? null,
      note: null,
    })
  } else {
    rows.push({ field: 'fullKana', label: 'ふりがな', column: null, note: null })
  }

  rows.push({
    field: 'appearanceCount',
    label: FIELD_LABELS.appearanceCount,
    column: sheet.columns.appearanceCount ?? null,
    note: null,
  })
  rows.push({ field: 'note', label: FIELD_LABELS.note, column: sheet.columns.note ?? null, note: null })

  return rows
}

/** `onColumnChange` で編集した1フィールド分の値を CellMap の対応シートへ書き戻す。 */
export function applyColumnChange(
  cellMap: CellMap,
  sheetIndex: number,
  field: MemberField,
  value: string | null,
): CellMap {
  return {
    sheets: cellMap.sheets.map((sheet, i) => {
      if (i !== sheetIndex) return sheet
      const columns = { ...sheet.columns }
      if (value) columns[field] = value
      else delete columns[field]
      return { ...sheet, columns }
    }),
  }
}
