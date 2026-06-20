import type { SheetData, CellValue } from './reader.js'
import {
  deriveGrade,
  normalizeText,
  parseResultChar,
  parseScoreCell,
} from './normalize.js'
import type {
  ParsedClass,
  ParsedMatch,
  ParsedParticipant,
} from './schema.js'

export const PARSER_VERSION = '1.0.0'

// ── Column map discovered from the signature header row ──────────────────────

interface RoundCols {
  round: number
  roundLabel: string | null
  opponentCol: number
  scoreCol: number
  resultCol: number
}

interface ColMap {
  seqNoCol: number | null
  playerNameCol: number
  kanaCol: number | null
  affiliationCol: number | null
  prefectureCol: number | null
  danCol: number | null
  memberNoCol: number | null
  rankCol: number | null
  /** non-null → multi-class sheet; value contains grade+class text */
  gradeCol: number | null
  classCol: number | null
  rounds: RoundCols[]
}

// ── Header signature detection ───────────────────────────────────────────────

/**
 * Returns true if the cell value matches the Japanese player name column header.
 * Handles: 「選手名」「氏名」「名前」「参加者」.
 */
function isPlayerNameHeader(v: string): boolean {
  // Exclude furigana/reading columns (e.g.「選手名ふりがな」「氏名カナ」) which also contain
  // 選手名/氏名: the 出場者DB layout places 選手名 and 選手名ふりがな side by side, and
  // last-match-wins otherwise picked the kana column → every name imported as hiragana.
  return /選手名|氏名|名前/.test(v) && !/ふりがな|フリガナ|カナ|読み|かな/.test(v)
}

function isOpponentHeader(v: string): boolean {
  return /相手/.test(v)
}

function isResultHeader(v: string): boolean {
  return /勝敗/.test(v)
}

function isScoreHeader(v: string): boolean {
  // 枚数 or 差 but NOT 勝敗. We use position-based fallback so this is just a hint.
  return /枚数|枚差/.test(v) && !/勝敗/.test(v)
}

/**
 * Scan a row for the universal header signature.
 * Returns { headerRowIdx, colMap } or null if no signature found.
 */
function detectSignatureRow(
  grid: readonly (readonly CellValue[])[],
): { headerRowIdx: number; colMap: ColMap } | null {
  for (let rowIdx = 0; rowIdx < Math.min(grid.length, 20); rowIdx++) {
    const row = grid[rowIdx] ?? []
    const cells = row.map((v) => (v != null ? normalizeText(v) : ''))

    let playerNameCol = -1
    const opponentCols: number[] = []
    const resultCols: number[] = []

    for (let c = 0; c < cells.length; c++) {
      const s = cells[c]!
      // First-match-wins: keep the first 選手名/氏名 column (kanji), not a later duplicate.
      if (playerNameCol < 0 && isPlayerNameHeader(s)) playerNameCol = c
      else if (isOpponentHeader(s)) opponentCols.push(c)
      else if (isResultHeader(s)) resultCols.push(c)
    }

    // Signature: ≥1 player name col, ≥1 opponent col, ≥1 result col
    if (playerNameCol < 0 || opponentCols.length < 1 || resultCols.length < 1) continue

    // Build round triplets: for each opponentCol, find its scoreCol and resultCol
    // WITHIN this round's column block only — i.e. up to the next opponentCol
    // (Codex R4 should_fix: a whole-row scan could pick up the next round's
    // 勝敗 header, and a fixed opCol+2 fallback misread layouts wider than
    // 相手/枚数/勝敗 such as 相手/枚数/備考/勝敗). Explicit headers within the
    // block win; fixed offsets are only a last-resort fallback.
    const rounds: RoundCols[] = []
    for (let i = 0; i < opponentCols.length; i++) {
      const opCol = opponentCols[i]!
      const blockEnd = i + 1 < opponentCols.length ? opponentCols[i + 1]! : cells.length

      let scoreCol = -1
      let resultCol = -1
      for (let c = opCol + 1; c < blockEnd; c++) {
        const s = cells[c]!
        if (scoreCol < 0 && isScoreHeader(s)) scoreCol = c
        if (resultCol < 0 && isResultHeader(s)) resultCol = c
      }
      // Fallback to the conventional 相手/枚数/勝敗 offsets when a header is absent.
      if (scoreCol < 0) scoreCol = opCol + 1
      if (resultCol < 0) resultCol = opCol + 2

      // Extract round label from the row above (if any), nearest non-null before opCol
      let roundLabel: string | null = null
      if (rowIdx > 0) {
        const labelRow = grid[rowIdx - 1] ?? []
        // scan leftward from opponentCol to find a 回戦 label
        for (let lc = opCol; lc >= Math.max(0, opCol - 4); lc--) {
          const lv = labelRow[lc]
          if (lv != null) {
            const ls = normalizeText(lv)
            if (/回戦|戦/.test(ls)) {
              roundLabel = ls
              break
            }
            // also accept bare round number from merge (e.g. cells like "1回戦" land at opCol)
            break
          }
        }
        if (!roundLabel) {
          const lv = labelRow[opCol]
          if (lv != null) {
            const ls = normalizeText(lv)
            if (/回戦|戦/.test(ls)) roundLabel = ls
          }
        }
      }

      rounds.push({ round: i + 1, roundLabel, opponentCol: opCol, scoreCol, resultCol })
    }

    if (rounds.length === 0) continue

    // Detect auxiliary columns
    const colMap: ColMap = {
      seqNoCol: null,
      playerNameCol,
      kanaCol: null,
      affiliationCol: null,
      prefectureCol: null,
      danCol: null,
      memberNoCol: null,
      rankCol: null,
      gradeCol: null,
      classCol: null,
      rounds,
    }

    // Auxiliary columns. Each detector takes the FIRST matching column (guarded by
    // `=== null`). Some 出場者DB layouts carry duplicate columns such as 所属会 + 所属会2,
    // where 所属会2 is usually blank — last-match-wins picked the blank one and dropped
    // every affiliation. First-match-wins keeps the primary column.
    for (let c = 0; c < cells.length; c++) {
      const s = cells[c]!
      if (c === playerNameCol) continue
      if (colMap.seqNoCol === null && (/^no\.?$/i.test(s) || s === '番号' || s === 'No')) colMap.seqNoCol = c
      else if (colMap.kanaCol === null && /ふりがな|フリガナ|読み|かな/.test(s)) colMap.kanaCol = c
      else if (colMap.affiliationCol === null && /所属/.test(s)) colMap.affiliationCol = c
      else if (colMap.prefectureCol === null && /都道府県/.test(s)) colMap.prefectureCol = c
      else if (colMap.danCol === null && /段位|段(?!位)/.test(s)) colMap.danCol = c
      else if (colMap.memberNoCol === null && /会員番号/.test(s)) colMap.memberNoCol = c
      else if (colMap.rankCol === null && /順位/.test(s)) colMap.rankCol = c
      else if (colMap.gradeCol === null && (/^[A-E]?級$/.test(s) || s === '級')) colMap.gradeCol = c
      else if (colMap.classCol === null && /^クラス$|^class$/i.test(s)) colMap.classCol = c
    }

    return { headerRowIdx: rowIdx, colMap }
  }
  return null
}

// ── Row parser ────────────────────────────────────────────────────────────────

function cellStr(row: readonly CellValue[], col: number | null): string | null {
  if (col == null || col < 0) return null
  const v = row[col]
  if (v == null) return null
  const s = normalizeText(v)
  return s || null
}

function parseDataRow(
  row: readonly CellValue[],
  colMap: ColMap,
): ParsedParticipant | null {
  const name = cellStr(row, colMap.playerNameCol)
  if (!name) return null

  const seqRaw = cellStr(row, colMap.seqNoCol)
  const seqNo = seqRaw != null && /^\d+$/.test(seqRaw) ? parseInt(seqRaw, 10) : null

  const matches: ParsedMatch[] = []
  for (const rc of colMap.rounds) {
    const opponentName = cellStr(row, rc.opponentCol)
    const scoreRaw = cellStr(row, rc.scoreCol)
    const resultRaw = cellStr(row, rc.resultCol)

    // If no result cell and no score, skip this round (player didn't play this many rounds)
    if (!resultRaw && !scoreRaw && !opponentName) continue

    const result = resultRaw ? parseResultChar(resultRaw) : null
    if (!result) continue // unparseable result → end of played rounds for this player

    const { scoreDiff, isWalkover, isForfeit } = parseScoreCell(scoreRaw)

    let status: 'normal' | 'walkover' | 'forfeit'
    if (isWalkover) {
      status = 'walkover'
    } else if (isForfeit) {
      status = 'forfeit'
    } else {
      status = 'normal'
    }

    matches.push({
      round: rc.round,
      roundLabel: rc.roundLabel,
      opponentName: opponentName || null,
      scoreDiff,
      result,
      status,
    })
  }

  return {
    seqNo,
    name,
    nameKana: cellStr(row, colMap.kanaCol),
    affiliation: cellStr(row, colMap.affiliationCol),
    prefecture: cellStr(row, colMap.prefectureCol),
    dan: cellStr(row, colMap.danCol),
    memberNo: cellStr(row, colMap.memberNoCol),
    finalRank: cellStr(row, colMap.rankCol),
    matches,
  }
}

// ── Sheet → ParsedClass[] ─────────────────────────────────────────────────────

/**
 * Parse a single sheet into ParsedClass[].
 * Returns [] if the sheet has no valid signature.
 */
function parseSheet(sheet: SheetData): ParsedClass[] {
  const result = detectSignatureRow(sheet.grid)
  if (!result) return []
  const { headerRowIdx, colMap } = result

  const isMultiClass = colMap.gradeCol != null

  if (isMultiClass) {
    // Group rows by grade+class key
    const classMap = new Map<string, { className: string; participants: ParsedParticipant[] }>()
    const classOrder: string[] = []

    for (let r = headerRowIdx + 1; r < sheet.grid.length; r++) {
      const row = sheet.grid[r] ?? []
      const gradeStr = cellStr(row, colMap.gradeCol) ?? ''
      const classStr = colMap.classCol != null ? (cellStr(row, colMap.classCol) ?? '') : ''

      // Derive class name: prefer explicit クラス col (e.g. "A1"), else grade string (e.g. "A級")
      const className = classStr || gradeStr
      if (!className) continue

      const participant = parseDataRow(row, colMap)
      if (!participant) continue

      if (!classMap.has(className)) {
        classMap.set(className, { className, participants: [] })
        classOrder.push(className)
      }
      classMap.get(className)!.participants.push(participant)
    }

    return classOrder.map((key) => {
      const { className, participants } = classMap.get(key)!
      return {
        className,
        grade: deriveGrade(className),
        sheetName: sheet.name,
        participants,
      }
    })
  } else {
    // Single-class sheet — derive class name from sheet name or first cell
    const className =
      deriveClassNameFromSheet(sheet) ??
      sheet.name

    const participants: ParsedParticipant[] = []
    for (let r = headerRowIdx + 1; r < sheet.grid.length; r++) {
      const row = sheet.grid[r] ?? []
      const p = parseDataRow(row, colMap)
      if (p) participants.push(p)
    }

    if (participants.length === 0) return []

    return [
      {
        className,
        grade: deriveGrade(className),
        sheetName: sheet.name,
        participants,
      },
    ]
  }
}

/**
 * Try to extract a short class name from the sheet name.
 * "対戦結果表_D1級" → "D1", "A級結果" → "A", "詳細結果" → null (caller uses sheet.name)
 */
function deriveClassNameFromSheet(sheet: SheetData): string | null {
  // Common pattern: シート名 contains "対戦結果表_X" or ends with "X級"
  const m1 = sheet.name.match(/対戦結果表[_\s]*([A-E]\d*)/)
  if (m1) return m1[1]!

  const m2 = sheet.name.match(/([A-E][0-9]*)級/)
  if (m2) return m2[1]!

  const m3 = sheet.name.match(/^([A-E])級/)
  if (m3) return m3[1]!

  // Check row 0 of the sheet for a short class code like "D1"
  const firstRow = sheet.grid[0] ?? []
  for (const cell of firstRow) {
    if (cell && /^[A-E]\d*$/.test(normalizeText(cell))) return normalizeText(cell)
  }

  return null
}

// ── Top-level entry ───────────────────────────────────────────────────────────

/**
 * Parse all sheets from a workbook into ParsedClass[].
 * Skips sheets without the universal signature (大会報告, 入賞者, etc.).
 */
export function parseResultExcel(sheets: SheetData[]): ParsedClass[] {
  // Same className across multiple sheets = one class split across sheets — MERGE
  // its participants rather than dropping the later sheet (Codex R4 blocker: a
  // className-keyed Set silently discarded the second sheet's participants/
  // matches, which would then be lost in the materialized tournament). grade /
  // sheetName keep the first sheet's values; insertion order is preserved.
  const byClassName = new Map<string, ParsedClass>()
  const order: string[] = []

  for (const sheet of sheets) {
    const parsed = parseSheet(sheet)
    for (const cls of parsed) {
      const existing = byClassName.get(cls.className)
      if (existing) {
        existing.participants.push(...cls.participants)
      } else {
        byClassName.set(cls.className, cls)
        order.push(cls.className)
      }
    }
  }

  return order.map((name) => byClassName.get(name)!)
}
