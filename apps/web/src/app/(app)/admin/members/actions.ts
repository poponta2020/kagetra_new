'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db-errors'
import {
  generateRegistrationToken,
  isValidExpiryPreset,
  registrationInviteExpiresAt,
} from '@/lib/registration-invite'
import { registrationInvites, users } from '@kagetra/shared/schema'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const

// Normalize a FormData entry for strict zod validation. Returns:
//   - null: when the field is missing or empty (→ nullable zod accepts as null)
//   - the trimmed string: otherwise (zod enum validates strictness)
function formEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

const createMemberSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '名前を入力してください')
    .max(50, '名前は50文字以内で入力してください'),
  // Unknown enum values (e.g. 'Z') → zod rejects (not silently → null)
  grade: z.enum(GRADES).nullable(),
})

export type CreateMemberState = {
  error?: string
  success?: boolean
}

async function assertAdminSession() {
  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    throw new Error('Unauthorized')
  }
  return session
}

/**
 * Create a new member row from the admin member list page.
 *
 * The row is created already-invited (`isInvited=true`) with no LINE binding,
 * so it immediately shows up as a /self-identify candidate — the member just
 * logs in with LINE and claims their own name. Role is fixed to 'member';
 * role management is deliberately out of scope here.
 */
export async function createMember(
  _prev: CreateMemberState,
  formData: FormData,
): Promise<CreateMemberState> {
  await assertAdminSession()

  const rawName = formData.get('name')
  const parsed = createMemberSchema.safeParse({
    name: typeof rawName === 'string' ? rawName : '',
    grade: formEntryOrNull(formData.get('grade')),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  try {
    await db.insert(users).values({
      name: parsed.data.name,
      grade: parsed.data.grade,
      role: 'member',
      isInvited: true,
      invitedAt: new Date(),
      lineUserId: null,
    })
  } catch (err) {
    // users.name は UNIQUE。退会済み会員も同じ制約に当たるため文言で明示する。
    if (isUniqueViolation(err)) {
      return { error: '同名の会員が既に存在します（退会済み会員を含む）' }
    }
    throw err
  }

  revalidatePath('/admin/members')
  return { success: true }
}

/**
 * Resolve the public origin for a `/register/<token>` link.
 *
 * Prefers `PUBLIC_BASE_URL` (the explicit prod origin, also used by the LINE
 * broadcast helpers and reliably set in production); falls back to the incoming
 * request's host so dev / preview environments produce working links without
 * extra config. The env path is checked first so unit tests can pin the origin
 * without a request context.
 */
async function resolveRegistrationBaseUrl(): Promise<string> {
  const envBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (envBase) return envBase
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) throw new Error('登録URLのホストを特定できません')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

export type CreateRegistrationInviteState = {
  error?: string
  /** Full `/register/<token>` URL — shown + copied in the issue modal. */
  url?: string
  /** ISO expiry, for the modal countdown / failure date display. */
  expiresAt?: string
}

/**
 * Issue a self-registration link. admin / vice_admin only (same authz as
 * createMember). One link is reusable by multiple people until it expires or is
 * revoked — there is no usage cap (requirements §6). Returns the full URL so the
 * modal can display and copy it; the token itself is never shown elsewhere.
 */
export async function createRegistrationInvite(
  preset: string,
): Promise<CreateRegistrationInviteState> {
  const session = await assertAdminSession()
  const createdBy = session.user?.id
  if (!createdBy) {
    // assertAdminSession guarantees a bound admin/vice_admin; defensive only.
    throw new Error('Unauthorized')
  }

  if (!isValidExpiryPreset(preset)) {
    return { error: '有効期限の指定が不正です' }
  }

  const now = new Date()
  const expiresAt = registrationInviteExpiresAt(preset, now)
  const token = generateRegistrationToken()

  await db.insert(registrationInvites).values({
    token,
    expiresAt,
    createdBy,
    createdAt: now,
  })

  const baseUrl = await resolveRegistrationBaseUrl()
  revalidatePath('/admin/members')
  return { url: `${baseUrl}/register/${token}`, expiresAt: expiresAt.toISOString() }
}

export type RevokeRegistrationInviteState = {
  error?: string
  success?: boolean
}

/**
 * Revoke an invite link (the mis-distribution safety valve). admin / vice_admin
 * only. Idempotent: the `revoked_at IS NULL` guard means re-revoking is a no-op
 * that preserves the original revoke time. Revoking a missing / already-revoked
 * link is treated as success (the UI only ever lists active links anyway).
 */
export async function revokeRegistrationInvite(
  id: string,
): Promise<RevokeRegistrationInviteState> {
  await assertAdminSession()

  await db
    .update(registrationInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(registrationInvites.id, id), isNull(registrationInvites.revokedAt)))

  revalidatePath('/admin/members')
  return { success: true }
}

export type ActiveRegistrationInvite = {
  id: string
  token: string
  createdAt: Date
  expiresAt: Date
}

/**
 * List currently-valid invite links (not revoked, not expired), newest first,
 * for the admin members page. admin / vice_admin only — this is a `'use server'`
 * export, so it is reachable as an RPC and must guard authz itself rather than
 * relying on the page's gate.
 */
export async function listActiveRegistrationInvites(
  now: Date = new Date(),
): Promise<ActiveRegistrationInvite[]> {
  await assertAdminSession()

  return db
    .select({
      id: registrationInvites.id,
      token: registrationInvites.token,
      createdAt: registrationInvites.createdAt,
      expiresAt: registrationInvites.expiresAt,
    })
    .from(registrationInvites)
    .where(and(isNull(registrationInvites.revokedAt), gt(registrationInvites.expiresAt, now)))
    .orderBy(desc(registrationInvites.createdAt))
}
