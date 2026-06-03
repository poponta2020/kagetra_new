/**
 * Deterministic composition of the displayed tournament name (`events.title`).
 *
 * tournament-title-grade-split: the AI extracts only the place-specific stem
 * `short_name_stem` (e.g. "東大阪"); the grade suffix is joined HERE in the
 * fixed A→E order. The result does not depend on the AI's output order or
 * duplicates — the same (stem, grades) always yields the same title. Used as
 * the approval-form initial value, which the operator can override.
 *
 *   composeTitle('東大阪', ['C','A','B']) === '東大阪ABC'   (input order ignored)
 *   composeTitle('酒田', ['B'])           === '酒田B'
 *   composeTitle('○○', ['A','B','C','D','E']) === '○○ABCDE'
 *   composeTitle('○○', null)             === '○○'          (grades unknown → stem only)
 *   composeTitle('○○', [])               === '○○'
 */
const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'] as const

export function composeTitle(
  stem: string | null,
  grades: readonly string[] | null,
): string {
  const base = (stem ?? '').trim()
  if (!grades || grades.length === 0) return base
  // Filter in fixed A→E order: order-independent, de-duplicated, and any
  // value outside A–E is ignored (never appended to the title).
  const suffix = GRADE_ORDER.filter((g) => grades.includes(g)).join('')
  return base + suffix
}
