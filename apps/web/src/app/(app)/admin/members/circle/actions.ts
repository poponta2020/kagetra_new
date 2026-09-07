'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { isSchoolYearForKind } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'

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

function formEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

export type BulkUpdateCircleState = {
  error?: string
  success?: boolean
  updatedCount?: number
}

/**
 * S3 の一括編集: 複数人のサークル所属・学部区分・学部等名・学年を1回の保存で
 * 更新する（requirements S3・AC-6）。
 *
 * フォームは行数が可変なので、各行の値を `<field>_${userId}` のキーで送り、
 * どの userId が対象かは `userIds`（同名 hidden input の繰り返し）で受け取る
 * — チェックが外れた行はそのキー自体が来ないため、対象の集合を別に持つ必要
 * がある（会員編集の checkbox と同じ理由）。
 *
 * OFF の行は会員編集（updateMemberProfile）と同じ不変条件で、学部属性を
 * 「任意・既存値は保持する（消さない）」— isCircleMember だけを更新し、
 * facultyKind/faculty/schoolYear には触れない。
 */
export async function bulkUpdateCircleMembers(
  _prev: BulkUpdateCircleState,
  formData: FormData,
): Promise<BulkUpdateCircleState> {
  await assertAdminSession()

  const userIds = formData
    .getAll('userIds')
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (userIds.length === 0) {
    return { error: '対象の会員がいません' }
  }

  type Row = {
    userId: string
    isCircleMember: boolean
    facultyKind: FacultyKind | null
    faculty: string | null
    schoolYear: string | null
  }
  const rows: Row[] = []

  for (const userId of userIds) {
    const isCircleMember = formData.get(`isCircleMember_${userId}`) === 'on'
    let facultyKind: FacultyKind | null = null
    let faculty: string | null = null
    let schoolYear: string | null = null

    if (isCircleMember) {
      const fk = formEntryOrNull(formData.get(`facultyKind_${userId}`))
      if (fk === 'undergraduate' || fk === 'graduate') {
        facultyKind = fk
      } else {
        return { error: '所属（学部／大学院）を選択してください' }
      }

      const fac = formEntryOrNull(formData.get(`faculty_${userId}`))
      if (!fac) return { error: '学部等名を入力してください' }
      if (fac.length > 50) return { error: '学部等名は50文字以内で入力してください' }
      faculty = fac

      const sy = formEntryOrNull(formData.get(`schoolYear_${userId}`))
      if (!sy || !isSchoolYearForKind(sy, facultyKind)) {
        return { error: '学年を選択してください' }
      }
      schoolYear = sy
    }

    rows.push({ userId, isCircleMember, facultyKind, faculty, schoolYear })
  }

  await db.transaction(async (tx) => {
    for (const row of rows) {
      if (row.isCircleMember) {
        await tx
          .update(users)
          .set({
            isCircleMember: true,
            facultyKind: row.facultyKind,
            faculty: row.faculty,
            schoolYear: row.schoolYear,
            updatedAt: new Date(),
          })
          .where(eq(users.id, row.userId))
      } else {
        // OFF: 学部属性は既存値を保持する（触らない）。
        await tx
          .update(users)
          .set({ isCircleMember: false, updatedAt: new Date() })
          .where(eq(users.id, row.userId))
      }
    }
  })

  revalidatePath('/admin/members')
  revalidatePath('/admin/members/circle')
  return { success: true, updatedCount: rows.length }
}
