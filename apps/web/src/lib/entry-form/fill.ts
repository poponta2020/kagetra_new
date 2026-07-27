import 'server-only'
import ExcelJS from 'exceljs'
import type { Grade } from '@kagetra/shared/types'
import type { CellMap, CellMapSheet, DanFormat, HeaderField } from './cell-map'

/**
 * entry-form-autofill タスク4: CellMap + 会員データ + 会定数から、記入済み xlsx の
 * バイト列を生成する。requirements §3.2.1 / §3.2.3 / §3.2.4 / §3.2.9。
 *
 * `fillEntryForm()` は「読み込み済みの Workbook」を受け取り、**そのオブジェクトを
 * 直接書き換えて** `xlsx.writeBuffer()` する（テンプレを複製しない）。呼び出し側
 * （タスク7 の Server Action）は記入のたびにテンプレを読み直すこと。
 */

/**
 * 会員1名分の記入用フィールド。users のスキーマ型をそのまま使わず平たい型にする
 * ——プレビュー画面（タスク7）で全セルを編集可能にする必要があり、編集後の値が
 * そのままここへ渡ってくる前提のため。
 */
export interface EntryFormMember {
  grade: Grade | null
  dan: number | null
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
  appearanceCount: number | null
  note: string | null
}

/** 会の定数（requirements §3.2.9）。`HeaderField` と1対1対応する。 */
export interface EntryFormConstants {
  prefecture: string | null
  clubName: string | null
  managerName: string | null
  phone: string | null
  email: string | null
  transferName: string | null
}

export interface FillEntryFormInput {
  members: EntryFormMember[]
  constants: EntryFormConstants
}

/** シートの用意された行数を超え、記入できなかった会員（設計点11）。 */
export interface FillEntryFormOverflow {
  sheetName: string
  members: EntryFormMember[]
}

export interface FillEntryFormResult {
  /** 記入後の xlsx バイト列。 */
  buffer: Buffer
  /**
   * どのシートの `targetGrades` にも一致せず、どこにも記入されなかった会員
   * （設計点8）。沈黙の欠落を作らないため、呼び出し側はこれを必ずユーザーに提示する。
   */
  unassignedMembers: EntryFormMember[]
  /** シートごとの行数超過（行の追加はしない。理由は {@link computeCapacity} 参照）。 */
  overflow: FillEntryFormOverflow[]
}

const HEADER_FIELDS: HeaderField[] = [
  'prefecture',
  'clubName',
  'managerName',
  'phone',
  'email',
  'transferName',
]

// ---------------------------------------------------------------------------
// 段位の整形（設計点7）
// ---------------------------------------------------------------------------

const DAN_N_LABELS: Record<number, string> = {
  1: '初段',
  2: '2段',
  3: '3段',
  4: '4段',
  5: '5段',
  6: '6段',
  7: '7段',
  8: '8段',
  9: '9段',
  10: '10段',
}

const DAN_KANJI_LABELS: Record<number, string> = {
  1: '初',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
  10: '十',
}

/**
 * 段位をテンプレの入力規則（ドロップダウン）の選択肢形式に合わせて整形する。
 * dan が `null`（未登録）と `0`（無段）はどちらも「無段」に丸める。
 * 1〜10 の範囲外（11段以上など実務上ほぼ起きない値）は、入力規則に無い値を
 * 選択肢へ無理に丸めるより実データをそのまま見せる方が安全という判断で、
 * danFormat によらず「n段」形式（例: `'11段'`）にフォールバックする
 * （プレビュー画面で編集可能なため、誤った値のまま提出されることはない）。
 */
export function formatDan(dan: number | null, danFormat: DanFormat): string {
  if (dan == null || dan === 0) return '無段'
  if (dan >= 1 && dan <= 10) {
    return danFormat === '漢数字' ? DAN_KANJI_LABELS[dan]! : DAN_N_LABELS[dan]!
  }
  return `${dan}段`
}

// ---------------------------------------------------------------------------
// 氏名・かなの結合（設計点10）
// ---------------------------------------------------------------------------

/**
 * 姓名結合型の列へ書く値を作る。姓名間は全角スペース区切りとする
 * ——和文の氏名記載で一般的な慣行（例: 「山田　太郎」）を採用する判断。
 * 片方だけ値がある場合は詰めて1語として書く（stray な全角スペースを残さない）。
 */
function combineNames(family: string | null, given: string | null): string | null {
  const parts = [family, given].filter((s): s is string => s != null && s !== '')
  if (parts.length === 0) return null
  return parts.join('　')
}

// ---------------------------------------------------------------------------
// セル書き込み（数式スキップ・結合セル解決。設計点5・6）
// ---------------------------------------------------------------------------

/**
 * 指定アドレスへ値を書く。ただし:
 * - 結合セルは左上（アンカー）以外へ書くと exceljs が値を捨てるため、常にアンカー側へ
 *   解決してから書く（`cell-map.ts` の `headerCells` はアンカーを返す設計だが、
 *   防御的にここでも解決する）。
 * - アンカーセルが数式セルなら何もしない（級別人数・参加費集計の COUNTIF/SUM 等、
 *   `standard.xlsx` の No 列・`split-kana.xlsx` の `I17` を上書きしないため）。
 */
function writeIfEditable(ws: ExcelJS.Worksheet, address: string, value: string | number): void {
  const requested = ws.getCell(address)
  const target = requested.isMerged ? ws.getCell(requested.master.address) : requested
  if (target.type === ExcelJS.ValueType.Formula) return
  target.value = value
}

function writeHeaderCells(ws: ExcelJS.Worksheet, sheet: CellMapSheet, constants: EntryFormConstants): void {
  for (const field of HEADER_FIELDS) {
    const address = sheet.headerCells[field]
    const value = constants[field]
    if (!address || value == null) continue
    writeIfEditable(ws, address, value)
  }
}

function writeMemberRow(ws: ExcelJS.Worksheet, sheet: CellMapSheet, row: number, member: EntryFormMember): void {
  const { columns, danFormat } = sheet

  // 参加級: NULL は空欄のまま（requirements §3.2.1 — 記入は空欄のまま作成可能、警告は
  // 呼び出し側=プレビュー画面が出す）。
  if (columns.grade && member.grade != null) {
    writeIfEditable(ws, `${columns.grade}${row}`, member.grade)
  }

  // 段位: 列がある場合は必ず書く（null/0 も「無段」という有効な整形結果になる）。
  if (columns.dan) {
    writeIfEditable(ws, `${columns.dan}${row}`, formatDan(member.dan, danFormat))
  }

  if (columns.fullName) {
    const full = combineNames(member.familyName, member.givenName)
    if (full != null) writeIfEditable(ws, `${columns.fullName}${row}`, full)
  } else {
    if (columns.familyName && member.familyName != null) {
      writeIfEditable(ws, `${columns.familyName}${row}`, member.familyName)
    }
    if (columns.givenName && member.givenName != null) {
      writeIfEditable(ws, `${columns.givenName}${row}`, member.givenName)
    }
  }

  if (columns.fullKana) {
    const full = combineNames(member.familyKana, member.givenKana)
    if (full != null) writeIfEditable(ws, `${columns.fullKana}${row}`, full)
  } else {
    if (columns.familyKana && member.familyKana != null) {
      writeIfEditable(ws, `${columns.familyKana}${row}`, member.familyKana)
    }
    if (columns.givenKana && member.givenKana != null) {
      writeIfEditable(ws, `${columns.givenKana}${row}`, member.givenKana)
    }
  }

  if (columns.appearanceCount && member.appearanceCount != null) {
    writeIfEditable(ws, `${columns.appearanceCount}${row}`, member.appearanceCount)
  }

  if (columns.note && member.note != null) {
    writeIfEditable(ws, `${columns.note}${row}`, member.note)
  }
}

// ---------------------------------------------------------------------------
// 記入可能行数の算出（設計点11）
// ---------------------------------------------------------------------------

/**
 * 記入対象列に何も無いまま何行スキャンしたら「本当に空き」とみなすかの上限。
 * 実物テンプレは行数が数百に及ぶことはまず無いが、`ws.rowCount` はシートの一部
 * （例: 単体テストで組み立てた最小構成のシート）がまだ何も触られていないと
 * `startRow` 未満のまま返るため、それだけを上限にすると「実際は空いているだけの
 * 行」を容量0と誤判定してしまう。十分大きな固定値で下駄を履かせる。
 */
const CAPACITY_SCAN_FALLBACK_ROWS = 500

/**
 * シートの記入開始行から、実際に使える行数を数える。
 *
 * `CellMap` は明細の終了行を持たないため、`startRow` から下へ向かって
 * 「記入対象列（`columns` にマップされた列）のいずれかに既に値がある行」に
 * 突き当たるまでを使用可能行とみなす（級別人数集計のラベル行・COUNTIF/SUM 行
 * ・後続シートの表題行等がこれに当たる。`standard.xlsx` は r37 の「参加級/人数」
 * ラベル行で止まる）。突き当たりが無いままシートの実使用範囲を超えたら、
 * そこで打ち切る（`ws.rowCount` と {@link CAPACITY_SCAN_FALLBACK_ROWS} の大きい方）。
 *
 * 行を追加して収める方針は取らない——追加した行には元テンプレの書式・入力規則が
 * 引き継がれず AC-10（非破壊性）を壊すため。超過分は `overflow` として呼び出し側に
 * そのまま返し、呼び出し側（プレビュー画面）が別紙・別便等の対応をユーザーに促す。
 */
function computeCapacity(ws: ExcelJS.Worksheet, sheet: CellMapSheet): number {
  const columnLetters = Object.values(sheet.columns).filter((v): v is string => v != null)
  if (columnLetters.length === 0) return Number.POSITIVE_INFINITY

  const upperBound = Math.max(ws.rowCount, sheet.startRow + CAPACITY_SCAN_FALLBACK_ROWS - 1)
  let row = sheet.startRow
  while (row <= upperBound) {
    const blocked = columnLetters.some((col) => ws.getCell(`${col}${row}`).value != null)
    if (blocked) break
    row++
  }
  return row - sheet.startRow
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * CellMap に従って会員データ・会定数を xlsx へ記入し、記入後のバイト列を返す。
 * 引数の `workbook` を直接書き換える（呼び出し側は毎回テンプレを読み直すこと）。
 */
export async function fillEntryForm(
  workbook: ExcelJS.Workbook,
  cellMap: CellMap,
  input: FillEntryFormInput,
): Promise<FillEntryFormResult> {
  const { members, constants } = input
  // 複数シートに跨って「どのシートの対象にもならなかった会員」を検出するため、
  // 級でマッチした（=書き込めたかどうかに関わらずどこかのシートの対象になった）
  // 会員のインデックスを集める（設計点8）。
  const matchedIndices = new Set<number>()
  const overflow: FillEntryFormOverflow[] = []

  for (const sheet of cellMap.sheets) {
    const ws = workbook.getWorksheet(sheet.sheetName)
    if (!ws) {
      throw new Error(`テンプレにシート「${sheet.sheetName}」が見つかりません`)
    }

    writeHeaderCells(ws, sheet, constants)

    const targetMembers = members
      .map((member, index) => ({ member, index }))
      .filter(
        ({ member }) =>
          sheet.targetGrades === null || (member.grade != null && sheet.targetGrades.includes(member.grade)),
      )
    if (targetMembers.length === 0) continue

    for (const { index } of targetMembers) matchedIndices.add(index)

    const capacity = computeCapacity(ws, sheet)
    const toWrite = targetMembers.slice(0, capacity)
    const excess = targetMembers.slice(capacity)

    toWrite.forEach(({ member }, offset) => {
      writeMemberRow(ws, sheet, sheet.startRow + offset, member)
    })

    if (excess.length > 0) {
      overflow.push({ sheetName: sheet.sheetName, members: excess.map(({ member }) => member) })
    }
  }

  const unassignedMembers = members.filter((_, index) => !matchedIndices.has(index))

  const buffer = await workbook.xlsx.writeBuffer()
  return { buffer, unassignedMembers, overflow }
}
