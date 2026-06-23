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
import { parseRoundCellText } from './round-cell.js'

export const PARSER_VERSION = '1.1.0'

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
  if (!result) {
    // W2 fallback: positional 「N回戦」 layouts the primary signature can't see
    // (相手/勝敗 split across rows, no sub-header, or newline-split header cells).
    // Only reached when the primary returns null, so it cannot regress any sheet
    // the primary already handles.
    const layout = detectRoundLayoutSignature(sheet.grid)
    return layout ? parseRoundLayoutSheet(sheet, layout) : []
  }
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

// ── W2: positional 「N回戦」 fallback ─────────────────────────────────────────────

interface RoundBlock {
  round: number
  roundLabel: string | null
  start: number // inclusive column
  end: number // exclusive column
  // When a sub-header identifies the roles inside the block, only these columns
  // are read (ignoring №/級/所属/勝/負 noise). All null → positional whole-block join.
  opponentCol: number | null
  markCol: number | null
  scoreCol: number | null
}

interface RoundLayout {
  /** first data row (after the 回戦 row and any 相手/勝敗 sub-header) */
  dataStartIdx: number
  nameRowIdx: number
  seqNoCol: number | null
  nameCol: number
  kanaCol: number | null
  affiliationCol: number | null
  gradeCol: number | null
  classCol: number | null
  rankCol: number | null
  blocks: RoundBlock[]
}

/** Strip ALL whitespace for header keyword matching (handles 相\n手 / 勝\n敗 cells). */
function headerKey(v: CellValue): string {
  return v != null ? normalizeText(v).replace(/\s+/g, '') : ''
}

/**
 * Fallback detector for positional 「N回戦」 layouts: a 回戦-labelled header row
 * with a 氏名/選手名 column, where each round packs 相手・○/×・枚数 by position
 * (with or without a 相手/勝敗 sub-header, and possibly with the score fused into
 * the mark cell e.g. "○11"). Returns null for anything that is not clearly a
 * per-player match table — team tables (no 氏名 header), ranking summaries (no
 * 回戦) and report sheets all fall through to [] / W3.
 */
function detectRoundLayoutSignature(
  grid: readonly (readonly CellValue[])[],
): RoundLayout | null {
  for (let rowIdx = 0; rowIdx < Math.min(grid.length, 20); rowIdx++) {
    const row = grid[rowIdx] ?? []
    const keys = row.map(headerKey)

    const kaisenCols: number[] = []
    for (let c = 0; c < keys.length; c++) {
      if (/回戦/.test(keys[c]!)) kaisenCols.push(c)
    }
    if (kaisenCols.length < 1) continue
    const firstK = kaisenCols[0]!

    // Name column: in this row or the row above/below, left of the first 回戦 block.
    let nameCol = -1
    let nameRowIdx = rowIdx
    for (const r of [rowIdx, rowIdx - 1, rowIdx + 1]) {
      if (r < 0 || r >= grid.length) continue
      const rk = (grid[r] ?? []).map(headerKey)
      for (let c = 0; c < Math.min(rk.length, firstK); c++) {
        if (isPlayerNameHeader(rk[c]!)) {
          nameCol = c
          nameRowIdx = r
          break
        }
      }
      if (nameCol >= 0) break
    }
    if (nameCol < 0) continue // no player-name header → not a per-player match table

    // A 相手/勝敗 sub-header row directly under the 回戦 row identifies, per block,
    // which columns hold 相手・○/×・枚数 (the rest — №/級/所属/勝/負 — is noise).
    const subRow = (grid[rowIdx + 1] ?? []).map(headerKey)
    const isOppHdr = (s: string) => /相手|対戦/.test(s) && !/(no|番号|所属|級|会|ふりがな|フリガナ|カナ)/i.test(s)
    // Header label, NOT a data mark: 勝敗 / 結果 / a combined "○✕" label (2+ mark
    // chars) / 勝 / 敗. A bare ○ or × is a data value, so must not match.
    const isMarkHdr = (s: string) => /勝敗|結果/.test(s) || /^[○×✕●]{2,}$/.test(s) || s === '勝' || s === '敗'
    const isScoreHdr = (s: string) => /枚数|枚差|点数|^差$/.test(s)
    const subHits = subRow.filter((s) => isOppHdr(s) || isMarkHdr(s) || /^(勝敗|枚数|枚差|差|数)$/.test(s)).length
    const hasSub = subHits >= 2
    // Always start below the 氏名 header row — even when it sits under the 回戦 row
    // with no sub-header — so the header row is never parsed as a "氏名" participant.
    const dataStartIdx = Math.max(hasSub ? rowIdx + 2 : rowIdx + 1, nameRowIdx + 1)

    // Uniform block width from the first gap; cap each block at the next 回戦 col.
    const width = (kaisenCols[1] ?? firstK + 3) - firstK
    const blocks: RoundBlock[] = kaisenCols.map((k, i) => {
      const start = k
      const end = i + 1 < kaisenCols.length ? kaisenCols[i + 1]! : k + width
      let opponentCol: number | null = null
      let markCol: number | null = null
      let scoreCol: number | null = null
      if (hasSub) {
        for (let c = start; c < Math.min(end, subRow.length); c++) {
          const s = subRow[c]!
          if (opponentCol === null && isOppHdr(s)) opponentCol = c
          else if (markCol === null && isMarkHdr(s)) markCol = c
          else if (scoreCol === null && isScoreHdr(s)) scoreCol = c
        }
      }
      return {
        round: i + 1,
        roundLabel: normalizeText(String(row[k] ?? '')) || `${i + 1}回戦`,
        start,
        end,
        opponentCol,
        markCol,
        scoreCol,
      }
    })

    // Auxiliary columns from the name row, left of the first 回戦 block.
    const nameKeys = (grid[nameRowIdx] ?? []).map(headerKey)
    let seqNoCol: number | null = null
    let kanaCol: number | null = null
    let affiliationCol: number | null = null
    let gradeCol: number | null = null
    let classCol: number | null = null
    let rankCol: number | null = null
    for (let c = 0; c < Math.min(nameKeys.length, firstK); c++) {
      if (c === nameCol) continue
      const s = nameKeys[c]!
      if (seqNoCol === null && (/^no\.?$/i.test(s) || s === '番号')) seqNoCol = c
      else if (kanaCol === null && /ふりがな|フリガナ|読み|かな/.test(s)) kanaCol = c
      else if (affiliationCol === null && /所属/.test(s)) affiliationCol = c
      else if (rankCol === null && /順位/.test(s)) rankCol = c
      else if (classCol === null && /^クラス$|^class$/i.test(s)) classCol = c
      else if (gradeCol === null && (/^[A-E]?級$/.test(s) || s === '級')) gradeCol = c
    }

    return {
      dataStartIdx,
      nameRowIdx,
      seqNoCol,
      nameCol,
      kanaCol,
      affiliationCol,
      gradeCol,
      classCol,
      rankCol,
      blocks,
    }
  }
  return null
}

/**
 * Parse one data row by joining each round block's cells and reusing
 * parseRoundCellText — order-independent, so [相手, ○, 枚数] / [相手, ○11] /
 * [○ 21 相手] all normalize to the same match.
 */
function parseRoundLayoutRow(
  row: readonly CellValue[],
  layout: RoundLayout,
): ParsedParticipant | null {
  const name = cellStr(row, layout.nameCol)
  if (!name) return null

  const seqRaw = cellStr(row, layout.seqNoCol)
  const seqNo = seqRaw != null && /^\d+$/.test(seqRaw) ? parseInt(seqRaw, 10) : null

  const matches: ParsedMatch[] = []
  for (const block of layout.blocks) {
    // Sub-header identified the roles → read only 相手/○×/枚数 (ignore №/級/所属/勝/負).
    // Otherwise (pure positional, no sub-header) join the whole block.
    const identified = block.opponentCol !== null || block.markCol !== null || block.scoreCol !== null
    const cols = identified
      ? [block.opponentCol, block.markCol, block.scoreCol].filter((c): c is number => c !== null)
      : Array.from({ length: block.end - block.start }, (_, i) => block.start + i)
    const parts: string[] = []
    for (const c of cols) {
      const v = row[c]
      if (v != null) {
        const s = normalizeText(v)
        if (s) parts.push(s)
      }
    }
    const joined = parts.join(' ')
    if (!joined) continue
    const cell = parseRoundCellText(joined)
    if (cell.empty || cell.result === null) continue
    matches.push({
      round: block.round,
      roundLabel: block.roundLabel,
      opponentName: cell.opponentName,
      scoreDiff: cell.scoreDiff,
      result: cell.result,
      status: cell.status,
    })
  }

  return {
    seqNo,
    name,
    nameKana: cellStr(row, layout.kanaCol),
    affiliation: cellStr(row, layout.affiliationCol),
    prefecture: null,
    dan: null,
    memberNo: null,
    finalRank: cellStr(row, layout.rankCol),
    matches,
  }
}

/** Parse a positional 回戦-layout sheet (single- or multi-class) into ParsedClass[]. */
function parseRoundLayoutSheet(sheet: SheetData, layout: RoundLayout): ParsedClass[] {
  const isMultiClass = layout.gradeCol != null
  const classMap = new Map<string, ParsedParticipant[]>()
  const order: string[] = []
  let anyMatch = false
  let oppTotal = 0
  let oppNameLike = 0

  for (let r = layout.dataStartIdx; r < sheet.grid.length; r++) {
    const row = sheet.grid[r] ?? []
    const p = parseRoundLayoutRow(row, layout)
    if (!p) continue
    if (p.matches.length > 0) anyMatch = true
    for (const m of p.matches) {
      if (m.opponentName) {
        oppTotal++
        if (!/^\d+$/.test(m.opponentName)) oppNameLike++
      }
    }

    let className: string
    if (isMultiClass) {
      const gradeStr = cellStr(row, layout.gradeCol) ?? ''
      const classStr = layout.classCol != null ? (cellStr(row, layout.classCol) ?? '') : ''
      className = classStr || gradeStr
      if (!className) continue
    } else {
      className = deriveClassNameFromSheet(sheet) ?? sheet.name
    }

    if (!classMap.has(className)) {
      classMap.set(className, [])
      order.push(className)
    }
    classMap.get(className)!.push(p)
  }

  // Guard: a 回戦-labelled sheet that produced no ○/× results at all is a team
  // score / ranking table that slipped the header guards — not a match table.
  if (!anyMatch) return []

  // Guard: if most non-null opponents are pure numbers, the round columns were
  // misread (a №/score matrix, not a 相手 table) — reject rather than emit junk.
  if (oppTotal >= 4 && oppNameLike / oppTotal < 0.5) return []

  return order
    .map((name) => ({
      className: name,
      grade: deriveGrade(name),
      sheetName: sheet.name,
      participants: classMap.get(name)!,
    }))
    .filter((c) => c.participants.length > 0)
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
