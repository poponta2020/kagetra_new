import type { SheetData, CellValue } from '@kagetra/mail-worker/result-import/reader'

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
  seqNo: number | null
}

export interface ParsedRoster {
  entries: ParsedRosterEntry[]
  sheetName: string
}

const norm = (s: CellValue): string => (s ?? '').normalize('NFKC').replace(/\s+/g, '').trim()

// ヘッダ語 → 列種別。包含一致（ヘッダセルが語を含めば採用）。
const HEADER_PATTERNS: { key: ColKey; words: string[] }[] = [
  { key: 'name', words: ['氏名', '名前', '選手名', '参加者名', '参加者', 'なまえ', 'お名前'] },
  { key: 'lastName', words: ['姓', '苗字', '名字'] },
  { key: 'firstName', words: ['名'] }, // 「名」は単独列のときだけ（後段で姓とセット判定）
  { key: 'kana', words: ['ふりがな', 'フリガナ', 'よみ', 'ヨミ', 'かな', 'カナ', '読み'] },
  { key: 'grade', words: ['級', 'クラス', 'class'] },
  { key: 'affiliation', words: ['所属', '団体', '支部', '会名', '所属会'] },
  { key: 'dan', words: ['段位', '段・級', '段'] },
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
  | 'status'
  | 'seq'

function classifyHeaderCell(cell: CellValue): ColKey | null {
  const v = norm(cell).toLowerCase()
  if (!v) return null
  for (const { key, words } of HEADER_PATTERNS) {
    for (const w of words) {
      if (v.includes(w.toLowerCase())) return key
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

    entries.push({
      rawName,
      rawKana: pick(row, cols.kana),
      grade: parseGrade(cols.grade !== undefined ? (row[cols.grade] ?? null) : null),
      rawAffiliation: pick(row, cols.affiliation),
      rawDan: pick(row, cols.dan),
      statusText: pick(row, cols.status),
      seqNo: parseSeq(cols.seq !== undefined ? (row[cols.seq] ?? null) : null),
    })
  }
  return { entries, sheetName: sheet.name }
}

/**
 * SheetData[] から名簿を解析する。氏名列を持つ最初のシートを採用。
 * どのシートにも氏名列が無い / エントリ 0 件なら throw（パース不能 = DB を汚さない）。
 */
export function parseRosterGrid(sheets: SheetData[]): ParsedRoster {
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet)
    if (parsed && parsed.entries.length > 0) return parsed
  }
  throw new Error('名簿の氏名列を検出できませんでした（対応様式の Excel か確認してください）')
}
