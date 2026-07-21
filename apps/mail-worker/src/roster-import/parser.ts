import { normalizePlayerName } from '../result-import/normalize.js'
import type { CellValue, SheetData } from '../result-import/reader.js'

export type ParsedSelectionOutcome = 'accepted' | 'waitlisted' | 'rejected' | 'unknown'

export interface ParsedRosterEntry {
  rawName: string
  rawKana: string | null
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  rawAffiliation: string | null
  rawDan: string | null
  statusText: string | null
  selectionOutcome: ParsedSelectionOutcome
  selectionExempt: boolean
  seqNo: number | null
  sourceSheetName: string
}

export interface RosterValidationIssue {
  code: 'duplicate_name_grade'
  message: string
  sheetNames: string[]
}

export interface ParsedRoster {
  entries: ParsedRosterEntry[]
  sheetName: string
  sheetNames: string[]
  validationIssues: RosterValidationIssue[]
}

type ColKey =
  | 'name'
  | 'lastName'
  | 'firstName'
  | 'kana'
  | 'grade'
  | 'affiliation'
  | 'dan'
  | 'outcome'
  | 'exempt'
  | 'status'
  | 'seq'

const HEADER_PATTERNS: { key: ColKey; words: string[]; exact?: boolean }[] = [
  { key: 'name', words: ['氏名', '名前', '選手名', '参加者名', '参加者', 'なまえ', 'お名前'] },
  { key: 'lastName', words: ['姓', '苗字', '名字'] },
  { key: 'firstName', words: ['名'], exact: true },
  { key: 'kana', words: ['ふりがな', 'フリガナ', 'よみ', 'ヨミ', 'かな', 'カナ', '読み'] },
  { key: 'grade', words: ['級', 'クラス', 'class'] },
  { key: 'affiliation', words: ['所属', '団体', '支部', '会名', '所属会'] },
  { key: 'dan', words: ['段位', '段・級', '段'] },
  { key: 'outcome', words: ['当落', '抽選結果', '選考結果', '選考区分'] },
  { key: 'exempt', words: ['抽選除外', '除外', '主催者枠', '主催枠', '優先対象'] },
  { key: 'status', words: ['状態', '出場', '繰上', '確定', '備考', '区分'] },
  { key: 'seq', words: ['no', 'no.', '№', '番号', '順', '整理番号'] },
]

function norm(value: CellValue): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').trim()
}

function classifyHeaderCell(cell: CellValue): ColKey | null {
  const value = norm(cell).toLowerCase()
  if (!value) return null
  for (const { key, words, exact } of HEADER_PATTERNS) {
    for (const word of words) {
      if (key === 'status' && value.includes('回数')) continue
      const normalizedWord = word.toLowerCase()
      if (exact ? value === normalizedWord : value.includes(normalizedWord)) return key
    }
  }
  return null
}

function findHeader(grid: CellValue[][]): { rowIndex: number; cols: Partial<Record<ColKey, number>> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(grid.length, 12); rowIndex += 1) {
    const cols: Partial<Record<ColKey, number>> = {}
    ;(grid[rowIndex] ?? []).forEach((cell, columnIndex) => {
      const key = classifyHeaderCell(cell)
      if (key && cols[key] === undefined) cols[key] = columnIndex
    })
    if (cols.name !== undefined || cols.lastName !== undefined) return { rowIndex, cols }
  }
  return null
}

function inferGrade(value: CellValue): ParsedRosterEntry['grade'] {
  const text = norm(value).toUpperCase()
  const explicit = text.match(/([A-E])(?:級|クラス|CLASS)/)
  if (explicit) return explicit[1] as ParsedRosterEntry['grade']
  return /^[A-E]$/.test(text) ? (text as ParsedRosterEntry['grade']) : null
}

export function parseSelectionOutcome(value: CellValue): ParsedSelectionOutcome {
  const text = norm(value)
  if (['キャンセル待ち', '繰上待ち', '補欠', '待機'].some((word) => text.includes(word))) {
    return 'waitlisted'
  }
  if (['落選', '不選', '抽選漏れ', '選外'].some((word) => text.includes(word))) return 'rejected'
  if (['当選', '選出', '採用'].some((word) => text.includes(word))) return 'accepted'
  return 'unknown'
}

function parseSelectionExempt(value: CellValue): boolean {
  const text = norm(value).toLowerCase()
  if (!text) return false
  if (['対象外', '非対象', '未対象', '非該当', '該当なし', 'なし', '無', 'false', 'no', '0', '×']
    .some((word) => text.includes(word))) return false
  return ['抽選除外', '除外', '主催者枠', '主催枠', '優先対象', '対象', '該当', 'true', 'yes', '1', '○']
    .some((word) => text.includes(word))
}

function pick(row: CellValue[], column: number | undefined): string | null {
  if (column === undefined) return null
  const value = (row[column] ?? '').trim()
  return value.length > 0 ? value : null
}

function parseSeq(value: CellValue): number | null {
  const match = norm(value).match(/(\d{1,5})/)
  return match ? Number.parseInt(match[1]!, 10) : null
}

function parseSheet(sheet: SheetData): ParsedRosterEntry[] | null {
  const header = findHeader(sheet.grid)
  if (!header) return null
  const sheetGrade = inferGrade(sheet.name)
  const sheetOutcome = parseSelectionOutcome(sheet.name)
  const sheetExempt = parseSelectionExempt(sheet.name)
  const entries: ParsedRosterEntry[] = []
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.grid.length; rowIndex += 1) {
    const row = sheet.grid[rowIndex] ?? []
    let rawName = pick(row, header.cols.name)
    if (!rawName && header.cols.lastName !== undefined) {
      const joined = `${pick(row, header.cols.lastName) ?? ''}${pick(row, header.cols.firstName) ?? ''}`.trim()
      rawName = joined.length > 0 ? joined : null
    }
    if (!rawName) continue
    const statusText = pick(row, header.cols.status)
    const rowOutcome = parseSelectionOutcome(
      header.cols.outcome === undefined ? statusText : (row[header.cols.outcome] ?? null),
    )
    const explicitExempt = pick(row, header.cols.exempt)
    entries.push({
      rawName,
      rawKana: pick(row, header.cols.kana),
      grade: inferGrade(header.cols.grade === undefined ? null : (row[header.cols.grade] ?? null)) ?? sheetGrade,
      rawAffiliation: pick(row, header.cols.affiliation),
      rawDan: pick(row, header.cols.dan),
      statusText,
      selectionOutcome: rowOutcome === 'unknown' ? sheetOutcome : rowOutcome,
      selectionExempt: explicitExempt === null ? sheetExempt : parseSelectionExempt(explicitExempt),
      seqNo: parseSeq(header.cols.seq === undefined ? null : (row[header.cols.seq] ?? null)),
      sourceSheetName: sheet.name,
    })
  }
  return entries
}

/** Parse all sheets containing a recognizable name header. */
export function parseRosterGrid(sheets: SheetData[]): ParsedRoster {
  const parsedSheets = sheets
    .map((sheet) => ({ name: sheet.name, entries: parseSheet(sheet) }))
    .filter((sheet): sheet is { name: string; entries: ParsedRosterEntry[] } =>
      sheet.entries !== null && sheet.entries.length > 0)
  if (parsedSheets.length === 0) {
    throw new Error('名簿の氏名列を検出できませんでした（対応様式の Excel か確認してください）')
  }

  const entries = parsedSheets.flatMap((sheet) => sheet.entries)
  const seen = new Map<string, ParsedRosterEntry>()
  const validationIssues: RosterValidationIssue[] = []
  for (const entry of entries) {
    const key = `${entry.grade ?? 'unknown'}:${normalizePlayerName(entry.rawName)}`
    const duplicate = seen.get(key)
    if (duplicate) {
      validationIssues.push({
        code: 'duplicate_name_grade',
        message: `同一級に重複する氏名があります: ${entry.rawName} (${duplicate.sourceSheetName}, ${entry.sourceSheetName})`,
        sheetNames: [duplicate.sourceSheetName, entry.sourceSheetName],
      })
      continue
    }
    seen.set(key, entry)
  }
  const sheetNames = parsedSheets.map((sheet) => sheet.name)
  return { entries, sheetName: sheetNames[0]!, sheetNames, validationIssues }
}
