import type { SheetData, CellValue } from '@kagetra/mail-worker/result-import/reader'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'

export type ParsedSelectionOutcome = 'accepted' | 'waitlisted' | 'rejected' | 'unknown'

export interface RosterValidationIssue {
  code: 'duplicate_name_grade'
  message: string
  sheetNames: string[]
}

export class RosterValidationError extends Error {
  constructor(public readonly issues: RosterValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'))
    this.name = 'RosterValidationError'
  }
}

/**
 * tournament-entry-rosters PR-3: 申込/確定名簿の Excel を決定的にパースする（AI 不使用）。
 *
 * 名簿は「氏名」を主キー列に、ふりがな/級/所属/段位/出場状態などが任意で並ぶ表。様式差が
 * 大きいのでヘッダ行をテキストで検出して列をマッピングする（result-import と同方針）。Excel の
 * 読み取り自体は mail-worker の readExcel に委譲し、本パーサは grid（SheetData[]）を受け取る純関数
 * （ファイル不要で単体テスト可能）。氏名列が見つからないシートは候補から外し、どのシートにも
 * 無ければ throw（DB を汚さない）。
 */

export interface ParsedRosterEntry {
  rawName: string
  rawKana: string | null
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  rawAffiliation: string | null
  rawDan: string | null
  /** ファイルに出場状態列があれば生テキスト（materialize が roster_entry_status へマップ）。 */
  statusText: string | null
  selectionOutcome: ParsedSelectionOutcome
  selectionExempt: boolean
  seqNo: number | null
  sourceSheetName: string
}

export interface ParsedRoster {
  entries: ParsedRosterEntry[]
  /** 後方互換: 最初に採用したシート名。 */
  sheetName: string
  /** 氏名表として採用した全シート。 */
  sheetNames: string[]
}

const norm = (s: CellValue): string => (s ?? '').normalize('NFKC').replace(/\s+/g, '').trim()

// ヘッダ語 → 列種別。既定は包含一致。exact:true は完全一致のみ。
const HEADER_PATTERNS: { key: ColKey; words: string[]; exact?: boolean }[] = [
  { key: 'name', words: ['氏名', '名前', '選手名', '参加者名', '参加者', 'なまえ', 'お名前'] },
  { key: 'lastName', words: ['姓', '苗字', '名字'] },
  // Codex R1 should_fix: 「名」は会名/所属会名などの一部に含まれるため **完全一致のみ**
  // （'名' 単独列だけを firstName とする。姓とセットで連結）。
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

function classifyHeaderCell(cell: CellValue): ColKey | null {
  const v = norm(cell).toLowerCase()
  if (!v) return null
  for (const { key, words, exact } of HEADER_PATTERNS) {
    for (const w of words) {
      const ww = w.toLowerCase()
      // 自己申告の「出場回数」は集計入力へ使わず、状態列としても解釈しない。
      if (key === 'status' && v.includes('回数')) continue
      if (exact ? v === ww : v.includes(ww)) return key
    }
  }
  return null
}

interface HeaderMap {
  rowIndex: number
  cols: Partial<Record<ColKey, number>>
}

/**
 * 先頭 ~12 行からヘッダ行を探す。氏名(name) もしくは 姓(lastName) を含む行をヘッダとみなす。
 * 最初に見つかった有効ヘッダ行を採用。
 */
function findHeader(grid: CellValue[][]): HeaderMap | null {
  const scan = Math.min(grid.length, 12)
  for (let r = 0; r < scan; r++) {
    const row = grid[r] ?? []
    const cols: Partial<Record<ColKey, number>> = {}
    row.forEach((cell, c) => {
      const key = classifyHeaderCell(cell)
      // 同種ヘッダが複数あれば最初の列を優先（first-wins）。
      if (key && cols[key] === undefined) cols[key] = c
    })
    if (cols.name !== undefined || cols.lastName !== undefined) {
      return { rowIndex: r, cols }
    }
  }
  return null
}

const GRADE_RE = /([A-E])/
function parseGrade(cell: CellValue): ParsedRosterEntry['grade'] {
  const v = norm(cell).toUpperCase()
  const m = v.match(GRADE_RE)
  return m ? (m[1] as ParsedRosterEntry['grade']) : null
}

function inferGradeFromSheetName(sheetName: string): ParsedRosterEntry['grade'] {
  const value = norm(sheetName).toUpperCase()
  const explicit = value.match(/([A-E])(?:級|クラス|CLASS)/)
  if (explicit) return explicit[1] as ParsedRosterEntry['grade']
  return /^[A-E]$/.test(value) ? (value as ParsedRosterEntry['grade']) : null
}

export function parseSelectionOutcome(cell: CellValue): ParsedSelectionOutcome {
  const value = norm(cell)
  if (!value) return 'unknown'
  if (['キャンセル待ち', '繰上待ち', '補欠', '待機'].some((word) => value.includes(word))) {
    return 'waitlisted'
  }
  if (['落選', '不選', '抽選漏れ', '選外'].some((word) => value.includes(word))) {
    return 'rejected'
  }
  if (['当選', '選出', '採用'].some((word) => value.includes(word))) return 'accepted'
  return 'unknown'
}

function parseSelectionExempt(cell: CellValue): boolean {
  const value = norm(cell).toLowerCase()
  if (!value) return false
  if (
    ['対象外', '非対象', '未対象', '非該当', '該当なし', 'なし', '無', 'false', 'no', '0', '×'].some(
      (word) => value.includes(word),
    )
  ) {
    return false
  }
  return ['抽選除外', '除外', '主催者枠', '主催枠', '優先対象', '対象', '該当', 'true', 'yes', '1', '○'].some(
    (word) => value.includes(word),
  )
}

function parseSeq(cell: CellValue): number | null {
  const v = norm(cell)
  const m = v.match(/(\d{1,5})/)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return Number.isFinite(n) ? n : null
}

function pick(row: CellValue[], col: number | undefined): string | null {
  if (col === undefined) return null
  const v = (row[col] ?? '').trim()
  return v === '' ? null : v
}

/** 1 シートを解析。氏名列が無ければ null。 */
function parseSheet(sheet: SheetData): ParsedRoster | null {
  const header = findHeader(sheet.grid)
  if (!header) return null
  const { cols } = header
  const entries: ParsedRosterEntry[] = []
  const sheetGrade = inferGradeFromSheetName(sheet.name)
  const sheetOutcome = parseSelectionOutcome(sheet.name)
  const sheetExempt = parseSelectionExempt(sheet.name)

  for (let r = header.rowIndex + 1; r < sheet.grid.length; r++) {
    const row = sheet.grid[r] ?? []
    // 氏名を組み立て: name 単独列があればそれ、無ければ 姓+名 を連結。
    let rawName: string | null = pick(row, cols.name)
    if (!rawName && cols.lastName !== undefined) {
      const last = pick(row, cols.lastName) ?? ''
      const first = cols.firstName !== undefined ? (pick(row, cols.firstName) ?? '') : ''
      const joined = `${last}${first}`.trim()
      rawName = joined === '' ? null : joined
    }
    if (!rawName) continue // 氏名が無い行（空行・小計など）はスキップ

    const statusText = pick(row, cols.status)
    const explicitOutcome = parseSelectionOutcome(
      cols.outcome !== undefined ? (row[cols.outcome] ?? null) : statusText,
    )
    const explicitExemption = pick(row, cols.exempt)
    entries.push({
      rawName,
      rawKana: pick(row, cols.kana),
      grade: parseGrade(cols.grade !== undefined ? (row[cols.grade] ?? null) : null) ?? sheetGrade,
      rawAffiliation: pick(row, cols.affiliation),
      rawDan: pick(row, cols.dan),
      statusText,
      selectionOutcome: explicitOutcome === 'unknown' ? sheetOutcome : explicitOutcome,
      selectionExempt:
        explicitExemption === null ? sheetExempt : parseSelectionExempt(explicitExemption),
      seqNo: parseSeq(cols.seq !== undefined ? (row[cols.seq] ?? null) : null),
      sourceSheetName: sheet.name,
    })
  }
  return { entries, sheetName: sheet.name, sheetNames: [sheet.name] }
}

/**
 * SheetData[] から名簿を解析する。氏名列を持つ全シートを採用し、級・当落を保持する。
 * 同一名簿・同一級で正規化氏名が重複する場合は、誤集計を避けるため検証エラーにする。
 * どのシートにも氏名列が無い / エントリ 0 件なら throw（パース不能 = DB を汚さない）。
 */
export function parseRosterGrid(sheets: SheetData[]): ParsedRoster {
  const parsedSheets: ParsedRoster[] = []
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet)
    if (parsed && parsed.entries.length > 0) parsedSheets.push(parsed)
  }
  if (parsedSheets.length === 0) {
    throw new Error('名簿の氏名列を検出できませんでした（対応様式の Excel か確認してください）')
  }

  const entries = parsedSheets.flatMap((parsed) => parsed.entries)
  const seen = new Map<string, ParsedRosterEntry>()
  for (const entry of entries) {
    const key = `${entry.grade ?? 'unknown'}:${normalizePlayerName(entry.rawName)}`
    const duplicate = seen.get(key)
    if (duplicate) {
      const message = `同一級に重複する氏名があります: ${entry.rawName} (${duplicate.sourceSheetName}, ${entry.sourceSheetName})`
      throw new RosterValidationError([
        {
          code: 'duplicate_name_grade',
          message,
          sheetNames: [duplicate.sourceSheetName, entry.sourceSheetName],
        },
      ])
    }
    seen.set(key, entry)
  }

  const sheetNames = parsedSheets.map((parsed) => parsed.sheetName)
  return { entries, sheetName: sheetNames[0]!, sheetNames }
}
