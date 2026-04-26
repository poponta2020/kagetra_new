/**
 * Parse `--since=...` argument.
 *
 * Timezone handling, in priority order:
 *   - Bare `YYYY-MM-DD` → JST start-of-day. `new Date('2026-04-12')` would
 *     resolve to UTC midnight (= 09:00 JST), which would silently drop mails
 *     received between 00:00 and 08:59 JST on that date.
 *   - ISO datetime with explicit offset (`Z`, `+09:00`, `-05:00`, etc.) →
 *     passed through unchanged.
 *   - ISO datetime without offset (`2026-04-12T15:00:00`) → JST. Otherwise
 *     `new Date(value)` would interpret it in the runtime's local timezone,
 *     which silently differs between a developer machine (JST) and a UTC
 *     production host. The app is JST-only, so defaulting to JST removes a
 *     class of nine-hour off-by-one bugs.
 */
export function parseSinceArg(value: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  // Trailing offset: `Z`, `±HHMM`, or `±HH:MM`.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
  let date: Date
  if (dateOnly) {
    date = new Date(`${value}T00:00:00+09:00`)
  } else if (!hasOffset) {
    date = new Date(`${value}+09:00`)
  } else {
    date = new Date(value)
  }
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--since must be a parseable date, got: ${value}`)
  }
  return date
}
