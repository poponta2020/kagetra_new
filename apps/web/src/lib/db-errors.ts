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

/**
 * Name of the violated constraint for a unique_violation, or null.
 *
 * Lets a caller branch on WHICH unique constraint fired when a table has more
 * than one (e.g. users.name vs users.line_user_id during invite registration).
 * Checks the error itself and the wrapped `cause`, mirroring isUniqueViolation.
 * Returns null when it is not a unique violation or the driver did not surface
 * a constraint name.
 */
export function uniqueViolationConstraint(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null
  const direct = (err as { constraint?: unknown }).constraint
  if (typeof direct === 'string') return direct
  const cause = (err as { cause?: unknown }).cause
  if (typeof cause === 'object' && cause !== null) {
    const c = (cause as { constraint?: unknown }).constraint
    if (typeof c === 'string') return c
  }
  return null
}
