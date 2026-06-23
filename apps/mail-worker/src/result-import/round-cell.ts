import { normalizeText } from './normalize.js'

export interface ParsedRoundCell {
  /** 'win' | 'lose' | null. null = no determinable result → caller skips the round. */
  result: 'win' | 'lose' | null
  /** 枚数差. null for walkover/forfeit or when no number is present. */
  scoreDiff: number | null
  status: 'normal' | 'walkover' | 'forfeit'
  /** Opponent display name (raw representation, NOT normalized for dedup). null when absent. */
  opponentName: string | null
  /** true when the cell carries no match data at all (blank cell). */
  empty: boolean
}

const WIN_MARK = /[○〇]/ // ○ U+25CB, 〇 U+3007
const LOSE_MARK = /[×✕]/ // × U+00D7, ✕ U+2715

/**
 * Parse the text content of one "round" cell into a structured match.
 *
 * Used by the HTML result parser (table.tournament_tree result cells) and the
 * positional Excel 「N回戦」 layout, both of which pack マーク (○/×) ・ 枚数 ・ 相手
 * separated by whitespace/newlines, e.g. "○ 4 北野律子". 不戦 (bye) cells carry
 * only "不戦" — in a player's own row a bye means they advanced, i.e. a walkover
 * WIN with no opponent/score.
 *
 * Extraction is by token TYPE (mark char / first integer / residual text), not
 * position, so it is robust to ordering and the heavy whitespace in the HTML
 * source. `normalize.ts` is intentionally NOT modified — parseScoreCell there
 * matches 不戦勝/棄権 by exact equality, but these cells contain the bare 不戦/棄権
 * substring, so the status is detected here via substring match.
 */
export function parseRoundCellText(raw: string): ParsedRoundCell {
  const text = normalizeText(raw)
  if (!text) {
    return { result: null, scoreDiff: null, status: 'normal', opponentName: null, empty: true }
  }

  const isWalkover = text.includes('不戦')
  const isForfeit = !isWalkover && text.includes('棄権')
  const status: ParsedRoundCell['status'] = isWalkover
    ? 'walkover'
    : isForfeit
      ? 'forfeit'
      : 'normal'

  // Result from an explicit ○/× mark; fall back to bye/forfeit semantics.
  let result: 'win' | 'lose' | null = null
  if (WIN_MARK.test(text)) result = 'win'
  else if (LOSE_MARK.test(text)) result = 'lose'
  if (result === null && isWalkover) result = 'win' // 不戦勝 = 進出 = win
  if (result === null && isForfeit) result = 'lose' // 棄権 = the withdrawing player loses

  // Tokenize after stripping marks + status keywords. The 枚数 score is the FIRST
  // standalone integer token; the remaining tokens form the opponent name. Only
  // that one token is dropped (not every digit), so an opponent name that happens
  // to contain a digit (e.g. "山田2郎") is preserved — opponentName is handed to
  // materialize raw for normalizePlayerName-based opponent resolution.
  const tokens = text
    .replace(/[○〇×✕]/g, ' ')
    .replace(/不戦勝?|棄権/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)

  let scoreDiff: number | null = null
  if (!isWalkover && !isForfeit) {
    const scoreIdx = tokens.findIndex((t) => /^\d+$/.test(t))
    if (scoreIdx >= 0) {
      scoreDiff = parseInt(tokens[scoreIdx]!, 10)
      tokens.splice(scoreIdx, 1)
    }
  }

  const opponentName = tokens.join(' ') || null
  const empty = result === null && scoreDiff === null && opponentName === null
  return { result, scoreDiff, status, opponentName, empty }
}
