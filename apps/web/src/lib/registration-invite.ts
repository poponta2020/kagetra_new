import { randomBytes } from 'node:crypto'

/**
 * Pure helpers for the invite-link self-registration flow. DB-free so they can
 * be unit-tested in isolation; the Server Actions and the /register page wrap
 * these around the actual `registration_invites` row lookup.
 *
 * Mirrors the shape of invite-code.ts, but the token here is a high-entropy
 * random (it rides in a URL, not spoken aloud) and validity is guarded purely
 * by an expiry preset plus a manual revoke — there is no per-person cap.
 */

export type RegistrationInviteExpiryPreset = '1d' | '7d' | '30d'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Expiry preset → lifetime in milliseconds. These are the only durations the
 * admin UI offers; the action validates the incoming preset against this map's
 * keys so an arbitrary TTL can never be injected.
 */
export const EXPIRY_PRESETS: Record<RegistrationInviteExpiryPreset, number> = {
  '1d': 1 * DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
}

/** Pre-selected option in the issue dialog. */
export const DEFAULT_EXPIRY_PRESET: RegistrationInviteExpiryPreset = '7d'

/** Ordered list for rendering the preset selector. */
export const EXPIRY_PRESET_OPTIONS: RegistrationInviteExpiryPreset[] = ['1d', '7d', '30d']

/** Narrow an untrusted string (form value) to a known preset. */
export function isValidExpiryPreset(value: unknown): value is RegistrationInviteExpiryPreset {
  return value === '1d' || value === '7d' || value === '30d'
}

/**
 * Generate a fresh URL-safe invite token.
 *
 * 32 random bytes → 43 base64url characters. base64url avoids `+` / `/` / `=`
 * so the token drops straight into `/register/<token>` without escaping. The
 * entropy is overkill for a link with operator-limited distribution, but it
 * costs nothing and keeps the URL unguessable (requirements §6).
 */
export function generateRegistrationToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Compute the expiry timestamp for an invite issued at `now` with `preset`.
 * Centralised so the DB column and the modal countdown agree on the TTL.
 */
export function registrationInviteExpiresAt(
  preset: RegistrationInviteExpiryPreset,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + EXPIRY_PRESETS[preset])
}

/**
 * True when `expiresAt` is missing or at/before `now`. Equal timestamps count
 * as already-expired (closed interval), matching invite-code.ts.
 */
export function isRegistrationInviteExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() <= now.getTime()
}

/**
 * The single source of truth for "can this invite still be used to register":
 * the row must exist, not be revoked, and not be expired. Both the page render
 * and the submit action call this so an open tab that crosses the expiry (or a
 * link revoked between render and submit) is rejected consistently.
 */
export function isRegistrationInviteUsable(
  invite: { revokedAt: Date | null; expiresAt: Date } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!invite) return false
  if (invite.revokedAt !== null) return false
  return !isRegistrationInviteExpired(invite.expiresAt, now)
}
