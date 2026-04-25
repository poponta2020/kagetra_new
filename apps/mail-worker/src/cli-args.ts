/**
 * Parse `--since=...` argument. Bare `YYYY-MM-DD` is interpreted as JST
 * start-of-day, not UTC: `new Date('2026-04-12')` resolves to UTC midnight
 * which is 09:00 JST, so mails received between 00:00 and 08:59 JST on that
 * date would be silently filtered out by the post-fetch `receivedAt < since`
 * check. Anything with an explicit time (`T...`, `Z`, or `±HH:MM` offset) is
 * passed through unchanged.
 */
export function parseSinceArg(value: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = dateOnly ? new Date(`${value}T00:00:00+09:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--since must be a parseable date, got: ${value}`)
  }
  return date
}
