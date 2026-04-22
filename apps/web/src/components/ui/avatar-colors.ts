/**
 * Deterministic avatar colour palette.
 *
 * Each entry is `[backgroundHex, foregroundHex]`. `Avatar` selects the pair
 * for a member via `id % AVATAR_COLORS.length`, so this list MUST stay a
 * stable length (8) and ordering to keep member chips visually stable across
 * renders/sessions.
 */
export const AVATAR_COLORS: readonly [string, string][] = [
  ['#DBEAFE', '#1E3A8A'],
  ['#FEE2E2', '#991B1B'],
  ['#DCFCE7', '#14532D'],
  ['#FEF3C7', '#92400E'],
  ['#E9D5FF', '#5B21B6'],
  ['#FCE7F3', '#9D174D'],
  ['#CFFAFE', '#155E75'],
  ['#FED7AA', '#9A3412'],
]
