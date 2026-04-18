'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
const GENDERS = ['male', 'female'] as const

// Normalize a FormData entry for strict zod validation. Returns:
//   - null: when the field is missing or empty (→ nullable zod accepts as null)
//   - the trimmed string: otherwise (zod enum / coerce validates strictness)
function formEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

const updateProfileSchema = z.object({
  userId: z.string().min(1),
  // Unknown enum values (e.g. 'Z', 'anything') → zod rejects (not silently → null)
  grade: z.enum(GRADES).nullable(),
  gender: z.enum(GENDERS).nullable(),
  affiliation: z.string().max(255).nullable(),
  // Strictly integer 0-9. Rejects '3abc', '3.5', negatives, etc.
  // Preprocess: empty/null → null; otherwise require /^\d+$/ and parse to int.
  dan: z.preprocess((v) => {
    if (v === null) return null
    if (typeof v !== 'string') return v
    const s = v.trim()
    if (s.length === 0) return null
    if (!/^\d+$/.test(s)) return Number.NaN // force zod int() to reject
    return Number.parseInt(s, 10)
  }, z.union([z.number().int().min(0).max(9), z.null()])),
  zenNichikyo: z.boolean(),
})

export type UpdateProfileState = {
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

export async function updateMemberProfile(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  await assertAdminSession()

  const parsed = updateProfileSchema.safeParse({
    userId: formData.get('userId'),
    grade: formEntryOrNull(formData.get('grade')),
    gender: formEntryOrNull(formData.get('gender')),
    affiliation: formEntryOrNull(formData.get('affiliation')),
    dan: formData.get('dan'),
    zenNichikyo: formData.get('zenNichikyo') === 'on',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }
  const data = parsed.data

  await db
    .update(users)
    .set({
      grade: data.grade,
      gender: data.gender,
      affiliation: data.affiliation,
      dan: data.dan,
      zenNichikyo: data.zenNichikyo,
      updatedAt: new Date(),
    })
    .where(eq(users.id, data.userId))

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${data.userId}/edit`)
  return { success: true }
}

/**
 * Toggle deactivation: if deactivated_at is NULL, set it to now(); otherwise
 * clear it. Admin-only.
 */
export async function toggleMemberDeactivation(formData: FormData) {
  await assertAdminSession()

  const userId = formData.get('userId')
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('userId が不正です')
  }

  const current = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, deactivatedAt: true },
  })
  if (!current) {
    throw new Error('対象会員が見つかりません')
  }

  const nextValue = current.deactivatedAt == null ? new Date() : null
  await db
    .update(users)
    .set({ deactivatedAt: nextValue, updatedAt: new Date() })
    .where(eq(users.id, userId))

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${userId}/edit`)
  redirect(`/admin/members/${userId}/edit`)
}
