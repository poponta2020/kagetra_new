import type { Grade } from '@kagetra/shared/types'
import type { CellMap, CellMapSheet, MemberField } from '@/lib/entry-form/cell-map'
import { asStandardGrade } from '@/lib/entry-form/grade-normalize'

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
    // どちらの形式も未推定。結合列（氏名）と分離列（姓/名）の両方を出して、
    // テンプレの形式に合わせてどちらでも指定できるようにする（姓名分離型の
    // テンプレを結合列しか指定できない状態にしない）。
    rows.push({ field: 'fullName', label: '氏名', column: null, note: '（姓名まとめて）' })
    rows.push({ field: 'familyName', label: FIELD_LABELS.familyName, column: null, note: '（姓/名が別列のとき）' })
    rows.push({ field: 'givenName', label: FIELD_LABELS.givenName, column: null, note: null })
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
    rows.push({ field: 'fullKana', label: 'ふりがな', column: null, note: '（姓名まとめて）' })
    rows.push({ field: 'familyKana', label: FIELD_LABELS.familyKana, column: null, note: '（姓/名が別列のとき）' })
    rows.push({ field: 'givenKana', label: FIELD_LABELS.givenKana, column: null, note: null })
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

/**
 * 空のシート定義を作る。ヒューリスティックも AI も対応を返せなかったとき
 * （`source: 'unresolved'`・`sheets` が空）に、ユーザーがシートを選んで
 * 手で列対応を組み立てられるようにするための出発点。
 *
 * `startRow` の既定は 2（1行目を見出しとみなす最小の仮定）。実際の値は
 * 画面で調整する。
 */
export function createManualSheet(sheetName: string): CellMapSheet {
  return {
    sheetName,
    targetGrades: null,
    startRow: 2,
    columns: {},
    headerCells: {},
    danFormat: 'n段',
  }
}

/** 手動マッピング中のシートの記入開始行を差し替える。 */
export function applyStartRowChange(
  cellMap: CellMap,
  sheetIndex: number,
  startRow: number,
): CellMap {
  return {
    sheets: cellMap.sheets.map((sheet, i) =>
      i === sheetIndex ? { ...sheet, startRow } : sheet,
    ),
  }
}

/**
 * 申込書として成立する最小条件。氏名（結合 or 姓＋名）が特定できていること。
 * ふりがなは無いテンプレもあるため必須にしない。
 */
export function isSheetFillable(sheet: CellMapSheet): boolean {
  const hasName =
    Boolean(sheet.columns.fullName) ||
    Boolean(sheet.columns.familyName && sheet.columns.givenName)
  return hasName && Number.isInteger(sheet.startRow) && sheet.startRow > 0
}

/**
 * 複数シートなのに対象級が決まっていないシートがあるか。
 *
 * `targetGrades: null` は「このシートに全会員を書く」の意味なので、複数シートで
 * null が残ったまま作成すると**全会員が全シートへ重複記入される**。級名が
 * 非標準（「上級」「中級」等）のテンプレで実際に起きるため、作成前に塞ぐ。
 */
export function hasUnresolvedSheetGrades(cellMap: CellMap): boolean {
  return cellMap.sheets.length > 1 && cellMap.sheets.some((s) => s.targetGrades === null)
}

/** シートの対象級を差し替える（空配列は「対象級なし」ではなく未設定=null に寄せる）。 */
export function applyTargetGradesChange(
  cellMap: CellMap,
  sheetIndex: number,
  grades: Grade[],
): CellMap {
  return {
    sheets: cellMap.sheets.map((sheet, i) =>
      i === sheetIndex ? { ...sheet, targetGrades: grades.length > 0 ? grades : null } : sheet,
    ),
  }
}

/** シートを記入対象から外す（対象級を決められないシートの逃げ道）。 */
export function removeSheet(cellMap: CellMap, sheetIndex: number): CellMap {
  return { sheets: cellMap.sheets.filter((_, i) => i !== sheetIndex) }
}

/**
 * 会員をそのシートへ振り分けるか。`targetGrades` が `null` のシートは全会員が対象。
 * 参加級は自由文字列（F級等）なので、A〜E に一致するものだけを標準級として比較する
 * （`fill.ts` の振分と同じ規則で、プレビューの人数と生成結果を食い違わせない）。
 */
export function matchesSheetGrades(
  targetGrades: readonly string[] | null,
  grade: string | null,
): boolean {
  if (targetGrades === null) return true
  const standard = asStandardGrade(grade)
  return standard != null && targetGrades.includes(standard)
}

/**
 * 複数シートで同じ級が2つ以上のシートに割り当てられているか。
 *
 * `fillEntryForm` はシートごとに独立して該当会員を書くため、重複すると同じ会員が
 * 2枚に記入される。`unassignedMembers` にも `overflow` にも現れないので、ここで
 * 塞がないと警告なしで二重記入された申込書ができる。
 */
export function findDuplicateGradeAssignments(cellMap: CellMap): Grade[] {
  const seen = new Map<Grade, number>()
  for (const sheet of cellMap.sheets) {
    for (const grade of sheet.targetGrades ?? []) {
      seen.set(grade, (seen.get(grade) ?? 0) + 1)
    }
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([g]) => g)
}
