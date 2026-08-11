/**
 * Registration invite kind constants shared by actions.ts / registration-invite-section.tsx.
 *
 * Kept out of actions.ts on purpose: that file has `'use server'` at the
 * top, and Next.js requires every export from a `'use server'` module to be
 * an async function. A plain `const` export there is a build-time error
 * that `tsc` / vitest won't catch (they don't run the Next compiler).
 */
//
// guest-role: the invite's `kind` fixes what registering through it creates.
// Kept as its own union (not reusing `UserRole`) so an invite can only ever be
// issued as `member` or `guest` — never `admin`/`vice_admin`.
export const REGISTRATION_INVITE_KINDS = ['member', 'guest'] as const
export type RegistrationInviteKind = (typeof REGISTRATION_INVITE_KINDS)[number]
