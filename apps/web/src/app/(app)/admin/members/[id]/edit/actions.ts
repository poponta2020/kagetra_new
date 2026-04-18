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

const updateProfileSchema = z.object({
  userId: z.string().min(1),
  grade: z.enum(GRADES).nullable(),
  gender: z.enum(GENDERS).nullable(),
  affiliation: z.string().nullable(),
  dan: z.number().int().min(0).max(9).nullable(),
  zenNichikyo: z.boolean(),
})

export type UpdateProfileState = {
  error?: string
  success?: boolean
}

function parseNullableString(raw: FormDataEntryValue | null): string | null {
  if (raw === null) return null
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s.length === 0 ? null : s
}

function parseNullableEnum<T extends readonly string[]>(
  raw: FormDataEntryValue | null,
  values: T,
): T[number] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  return (values as readonly string[]).includes(raw) ? (raw as T[number]) : null
}

function parseNullableInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
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
    grade: parseNullableEnum(formData.get('grade'), GRADES),
    gender: parseNullableEnum(formData.get('gender'), GENDERS),
    affiliation: parseNullableString(formData.get('affiliation')),
    dan: parseNullableInt(formData.get('dan')),
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
