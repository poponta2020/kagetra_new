/**
 * LINE Messaging API caps a single text message at 5000 characters. The
 * broadcast pipeline sends mail bodies verbatim, so we need to split anything
 * longer along reader-friendly boundaries — paragraph breaks first, then
 * sentence breaks, then a hard cut as a last resort. A naïve `substring` would
 * split mid-word and produce ugly LINE bubbles.
 */

const DEFAULT_LIMIT = 5000

/** Paragraph break (two or more newlines). */
const PARAGRAPH_BOUNDARY = /\n{2,}/g
/** Sentence-like boundary (line break or Japanese sentence terminators). */
const SOFT_BOUNDARY = /[\n。！？!?]/g

export interface SplitOptions {
  limit?: number
}

/**
 * Split `text` into chunks at most `limit` characters long.
 *
 * Strategy per chunk:
 *   1. If the remaining text fits, return it as the final chunk.
 *   2. Otherwise look for the rightmost paragraph break inside the limit.
 *   3. Fall back to the rightmost sentence-ish boundary.
 *   4. As a last resort hard-cut at the limit (only happens for
 *      pathological inputs with no natural boundary in the first 5000
 *      characters).
 *
 * The returned chunks include the trailing boundary character(s) so
 * concatenation rebuilds the original.
 */
export function splitForLine(text: string, options: SplitOptions = {}): string[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  if (limit <= 0) {
    throw new Error('splitForLine: limit must be positive')
  }
  if (text.length <= limit) return text.length === 0 ? [] : [text]

  const chunks: string[] = []
  let cursor = 0

  while (cursor < text.length) {
    const remaining = text.slice(cursor)
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    const window = remaining.slice(0, limit)

    const paragraphCut = findLastMatchEnd(window, PARAGRAPH_BOUNDARY)
    let cut = paragraphCut

    if (cut < limit / 2) {
      // If the paragraph break landed in the first half, the chunk would
      // be too short. Prefer a sentence break further to the right.
      const softCut = findLastMatchEnd(window, SOFT_BOUNDARY)
      if (softCut > cut) cut = softCut
    }

    if (cut <= 0) {
      // No usable boundary — hard cut. We still avoid splitting a surrogate
      // pair by scanning back to the nearest non-low-surrogate position.
      cut = safeHardCut(window)
    }

    chunks.push(remaining.slice(0, cut))
    cursor += cut
  }

  return chunks
}

/**
 * Return the index *after* the last match of `pattern` inside `window`, or
 * 0 when there is none. Used to split right after a paragraph break so the
 * break itself stays with the preceding chunk (matches a reader's mental
 * model — "the paragraph ended, then a new one started").
 */
function findLastMatchEnd(window: string, pattern: RegExp): number {
  pattern.lastIndex = 0
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(window)) !== null) {
    last = match.index + match[0].length
    if (match.index === pattern.lastIndex) pattern.lastIndex++ // avoid infinite loop on zero-width
  }
  return last
}

/**
 * Walk backwards from `limit` until we land on a position that does not
 * split a UTF-16 surrogate pair. JavaScript strings are UTF-16, so cutting
 * between a high surrogate (this chunk's last char) and its low surrogate
 * (next chunk's first char) would emit invalid input to the LINE API.
 *
 * The check looks at the character ending this chunk: if it's a high
 * surrogate, we step back one so the entire pair lives in the *next* chunk.
 */
function safeHardCut(window: string): number {
  let cut = window.length
  while (cut > 0) {
    const ch = window.charCodeAt(cut - 1)
    if (ch >= 0xd800 && ch <= 0xdbff) {
      cut -= 1
      continue
    }
    return cut
  }
  return 0
}

export const _internal = {
  DEFAULT_LIMIT,
  PARAGRAPH_BOUNDARY,
  SOFT_BOUNDARY,
}
