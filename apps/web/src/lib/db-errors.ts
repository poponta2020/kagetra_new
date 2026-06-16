/**
 * PostgreSQL unique_violation (SQLSTATE 23505) detector.
 *
 * Drizzle may surface the pg DatabaseError directly (`code` on the error
 * itself) or wrapped in a DrizzleQueryError (`code` on `cause`), so both
 * shapes are checked. Callers turn this into a user-facing "duplicate"
 * error instead of a 500.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  if (code === '23505') return true
  const cause = (err as { cause?: unknown }).cause
  if (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === '23505'
  ) {
    return true
  }
  return false
}
