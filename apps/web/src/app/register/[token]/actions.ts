'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth, unstable_update } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation, uniqueViolationConstraint } from '@/lib/db-errors'
import { isRegistrationInviteUsable } from '@/lib/registration-invite'
import { registrationInvites, users } from '@kagetra/shared/schema'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const

// Mirrors createMember's input contract (name 1–50, grade A–E or null). Kept
// local so the public register flow doesn't depend on the admin actions module.
const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '名前を入力してください')
    .max(50, '名前は50文字以内で入力してください'),
  grade: z.enum(GRADES).nullable(),
})

function gradeEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

export type RegisterViaInviteState = {
  error?: string
}

/**
 * Complete invite-link self-registration: create the member row and bind it to
 * the current LINE session.
 *
 * `token` is bound via `.bind(null, token)` in the form so this stays a
 * useActionState `(prevState, formData)` action. Flow:
 *   1. Already bound (session.user.id) → nothing to do, go to dashboard.
 *      No LINE session yet → bounce back to the link to (re)start OAuth.
 *   2. Re-validate the token (not revoked, not expired) — the page also checked
 *      at render, but an open tab can cross the expiry, so re-check at submit.
 *   3. Validate name/grade.
 *   4. INSERT users(role=member, isInvited, lineUserId, method=invite_link).
 *      users.name UNIQUE → contact-admin message; users.line_user_id UNIQUE
 *      (double-submit / race — this LINE account already registered) → just log
 *      them in.
 *   5. Best-effort JWT refresh (self-heals via nodeJwtCallback if it fails) →
 *      dashboard.
 */
export async function registerViaInvite(
  token: string,
  _prev: RegisterViaInviteState,
  formData: FormData,
): Promise<RegisterViaInviteState> {
  const session = await auth()
  // Already a fully-bound member → registration is unnecessary.
  if (session?.user?.id) redirect('/')
  // LINE OAuth not completed (or session expired between render and submit):
  // send them back to the link, which shows the "LINEで登録" button.
  const lineUserId = session?.user?.lineUserId
  if (!lineUserId) redirect(`/register/${token}`)

  // Re-validate the token at submit time (revoked / expired since render).
  const invite = await db.query.registrationInvites.findFirst({
    where: eq(registrationInvites.token, token),
    columns: { revokedAt: true, expiresAt: true },
  })
  if (!isRegistrationInviteUsable(invite)) {
    return { error: '招待リンクの有効期限が切れています。' }
  }

  const parsed = registerSchema.safeParse({
    name: typeof formData.get('name') === 'string' ? formData.get('name') : '',
    grade: gradeEntryOrNull(formData.get('grade')),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  const now = new Date()
  try {
    await db.insert(users).values({
      name: parsed.data.name,
      grade: parsed.data.grade,
      role: 'member',
      isInvited: true,
      invitedAt: now,
      lineUserId,
      lineLinkedAt: now,
      lineLinkedMethod: 'invite_link',
    })
  } catch (err) {
    // redirect() throws a sentinel — let Next.js handle it.
    if (isRedirectError(err)) throw err
    if (isUniqueViolation(err)) {
      const constraint = uniqueViolationConstraint(err) ?? ''
      // Same LINE account already has a member row (double-submit / race):
      // the registration effectively already happened → log them straight in.
      if (constraint.includes('line_user_id')) {
        redirect('/')
      }
      // Otherwise the name collided (users.name UNIQUE, incl. deactivated).
      return { error: '同名の会員が既に存在します。管理者にご連絡ください。' }
    }
    throw err
  }

  try {
    await unstable_update({
      user: {
        lineLinkedAt: now.toISOString(),
        lineLinkedMethod: 'invite_link',
      },
    })
  } catch {
    // JWT refresh failure self-heals on the next Node render via nodeJwtCallback.
  }

  revalidatePath('/')
  redirect('/')
}

function isRedirectError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.includes('NEXT_REDIRECT')
}
