'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { auth, unstable_update } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'

const inputSchema = z.object({ userId: z.string().min(1) })

/**
 * Self-identify claim: bind the current session's LINE user ID to the selected
 * invited member row.
 *
 * The UPDATE is a single statement with all preconditions in the WHERE clause
 * — if any of them fail (row was claimed by someone else, member was
 * deactivated, etc.) it returns zero rows and we redirect back with an error.
 * This keeps the race-safe path tight without explicit locking.
 */
export async function claimMemberIdentity(formData: FormData) {
  const session = await auth()
  const lineUserId = session?.user?.lineUserId
  if (!lineUserId) redirect('/auth/signin')
  // 既に内部 user.id まで持っている場合、自己申告は不要 (middleware が
  // 通常ここに来させないが二重防御)。
  if (session.user?.id) redirect('/')

  const parsed = inputSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) redirect('/self-identify?error=invalid_input')

  const now = new Date()
  try {
    const updated = await db
      .update(users)
      .set({
        lineUserId,
        lineLinkedAt: now,
        lineLinkedMethod: 'self_identify',
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, parsed.data.userId),
          isNull(users.lineUserId),
          eq(users.isInvited, true),
          isNull(users.deactivatedAt),
        ),
      )
      .returning({ id: users.id })

    if (updated.length === 0) {
      // 他者 claim / 未招待 / 退会済 etc. 候補の最新状態を再表示させる。
      redirect('/self-identify?error=unavailable')
    }
  } catch (err) {
    // next/navigation redirect() throws a sentinel error — re-throw it so
    // Next.js can handle it. Only our DB-level errors should be inspected.
    if (isRedirectError(err)) throw err
    // UNIQUE violation: 同じ lineUserId を別 row に持つケース (通常発生しにくい
    // が、account switch と衝突する race 等で起こり得る)。
    if (isUniqueViolation(err)) {
      redirect('/self-identify?error=duplicate')
    }
    throw err
  }

  try {
    await unstable_update({
      user: {
        lineLinkedAt: now.toISOString(),
        lineLinkedMethod: 'self_identify',
      },
    })
  } catch {
    // JWT refresh 失敗は nodeJwtCallback の次回 Node render で自動回復。
  }

  revalidatePath('/')
  redirect('/')
}

function isRedirectError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.includes('NEXT_REDIRECT')
}

function isUniqueViolation(err: unknown): boolean {
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
