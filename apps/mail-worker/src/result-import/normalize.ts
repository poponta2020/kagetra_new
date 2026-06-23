/** NFKC + trim + collapse whitespace */
export function normalizeText(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

/**
 * Derive grade letter (A–E) from a class name or sheet name.
 * Looks for 「A|B|C|D|E」 followed by 「級」 or as a standalone prefix.
 */
export function deriveGrade(name: string): 'A' | 'B' | 'C' | 'D' | 'E' | null {
  const n = normalizeText(name).toUpperCase()
  // e.g. "A級", "A1", "AB", "D3", "A 級", sheet "対戦結果表_D1級"
  const m = n.match(/([ABCDE])(?:級|[0-9]|\s*$)/)
  if (m) {
    const g = m[1] as 'A' | 'B' | 'C' | 'D' | 'E'
    if ('ABCDE'.includes(g)) return g
  }
  // fallback: leading grade letter in e.g. "A級 A1"
  const m2 = n.match(/^([ABCDE])/)
  if (m2) return m2[1] as 'A' | 'B' | 'C' | 'D' | 'E'
  return null
}

/**
 * Parse a win/lose indicator cell value.
 * Accepts ○ (U+25CB), 〇 (U+3007), × (U+00D7 / U+00D7 lookalike), ● (U+25CF, used
 * as 負 in some 成績表). Returns null if unrecognized (row skipped / end-of-data).
 */
export function parseResultChar(s: string): 'win' | 'lose' | null {
  const n = normalizeText(s)
  if (n === '○' || n === '〇') return 'win'
  if (n === '×' || n === '✕' || n === '×' || n === '●') return 'lose'
  return null
}

/**
 * Parse the 枚数 (score difference) cell value.
 * Returns { scoreDiff, scoreText } where scoreDiff is null for 不戦勝/棄権.
 */
export function parseScoreCell(raw: string | null | undefined): {
  scoreDiff: number | null
  isWalkover: boolean
  isForfeit: boolean
} {
  if (raw == null) return { scoreDiff: null, isWalkover: false, isForfeit: false }
  const s = normalizeText(String(raw))
  if (s === '不戦勝') return { scoreDiff: null, isWalkover: true, isForfeit: false }
  if (s === '棄権') return { scoreDiff: null, isWalkover: false, isForfeit: true }
  const n = Number(s)
  if (!isNaN(n) && Number.isInteger(n) && n >= 0) return { scoreDiff: n, isWalkover: false, isForfeit: false }
  return { scoreDiff: null, isWalkover: false, isForfeit: false }
}

/** Normalize a participant name for player master dedup (get-or-create key) */
export function normalizePlayerName(name: string): string {
  return (
    name
      .normalize('NFKC')
      // strip all spaces. NFKC above already folds 全角 space (U+3000) to a
      // regular space, so \s covers both 全角・半角 (and avoids a literal
      // irregular-whitespace char in the source).
      .replace(/\s+/g, '')
      // common kanji variant pairs that appear in real data
      .replace(/髙/g, '高')
      .replace(/﨑/g, '崎')
      .replace(/邉/g, '辺')
      .replace(/邊/g, '辺')
      .replace(/濵/g, '浜')
      .replace(/濱/g, '浜')
      .replace(/塚/g, '塚') // 塚 U+585A stays, 塚 U+FA10 → normalize via NFKC already
  )
}
