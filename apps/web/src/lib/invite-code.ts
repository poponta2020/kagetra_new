import { randomInt } from 'node:crypto'

/**
 * 30 minutes — long enough for the operator to create a LINE group, invite
 * the Bot, and have someone speak the code. Short enough that a leaked
 * screenshot of the modal is mostly worthless after the meeting ends.
 */
export const INVITE_CODE_TTL_MS = 30 * 60 * 1000

const INVITE_CODE_PATTERN = /^\d{6}$/

/**
 * Generate a fresh 6-digit invite code as a zero-padded string.
 *
 * Uses `crypto.randomInt` (CSPRNG-backed) rather than `Math.random` because
 * the code is the sole proof-of-knowledge in the LINE binding flow: an
 * attacker who can predict it could hijack a freshly-created broadcast.
 */
export function generateInviteCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * Compute the expiry timestamp for a code generated at `now`. Centralised so
 * the DB column, the modal display, and the verify path agree on the TTL.
 */
export function inviteCodeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_CODE_TTL_MS)
}

/**
 * True when `expiresAt` is missing or strictly in the past relative to
 * `now`. Equal timestamps are treated as already-expired (closed interval).
 */
export function isInviteCodeExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() <= now.getTime()
}

/**
 * Cheap shape check before hitting the DB / verify path. Mirrors the regex
 * the LINE webhook uses to decide whether a group message looks like a
 * code submission.
 */
export function isValidInviteCodeFormat(value: string): boolean {
  return INVITE_CODE_PATTERN.test(value)
}

export type InviteCodeVerificationFailure =
  | 'format_invalid'
  | 'not_issued'
  | 'expired'
  | 'mismatch'

export type InviteCodeVerificationResult =
  | { ok: true }
  | { ok: false; reason: InviteCodeVerificationFailure }

/**
 * Verify a code submitted via the LINE webhook against the DB-stored
 * pair `{ storedCode, expiresAt }`.
 *
 * Distinct failure reasons let the caller log diagnostics without exposing
 * them to the LINE reply (the user-facing message is the same "❌ 招待コードが
 * 無効です" regardless of why).
 */
export function verifyInviteCode(
  input: string,
  storedCode: string | null | undefined,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): InviteCodeVerificationResult {
  if (!isValidInviteCodeFormat(input)) {
    return { ok: false, reason: 'format_invalid' }
  }
  if (!storedCode) {
    return { ok: false, reason: 'not_issued' }
  }
  if (isInviteCodeExpired(expiresAt, now)) {
    return { ok: false, reason: 'expired' }
  }
  if (input !== storedCode) {
    return { ok: false, reason: 'mismatch' }
  }
  return { ok: true }
}
