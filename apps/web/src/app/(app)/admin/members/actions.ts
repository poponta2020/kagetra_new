'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db-errors'
import { users } from '@kagetra/shared/schema'

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
