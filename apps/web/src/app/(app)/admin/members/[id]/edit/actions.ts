'use server'

import { and, eq, isNull, or } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db-errors'
import {
  accounts,
  eventAttendances,
  events,
  lineChannels,
  mailMessages,
  mailWorkerJobs,
  mailWorkerRuns,
  pushSubscriptions,
  scheduleItems,
  sessions,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
const GENDERS = ['male', 'female'] as const
// invite-register-redesign: ひらがな（小書き含む）＋長音記号 ー のみ。
const HIRAGANA_RE = /^[ぁ-ゖー]+$/
const PHONE_RE = /^[0-9-]+$/

// Normalize a FormData entry for strict zod validation. Returns:
//   - null: when the field is missing or empty (→ nullable zod accepts as null)
//   - the trimmed string: otherwise (zod enum / coerce validates strictness)
function formEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

// 'YYYY-MM-DD', a real calendar date, year ≥ 1900, not in the future.
// Mirrors validateBirthDate in the register flow so both write paths into the
// shared users.birth_date column reject the same values — a future birth date
// is invalid regardless of whether it was entered at self-registration or by
// an admin editing the profile.
function isRealYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d ||
    y < 1900
  ) {
    return false
  }
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return dt.getTime() <= todayUtc
}

const unlinkLineInputSchema = z.object({ userId: z.string().min(1) })

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
  // invite-register-redesign: structured name + 全日協 PII. Admin/vice_admin can
  // view + edit; all nullable (empty → null). `name` stays canonical and is NOT
  // recomposed here — these columns are auxiliary profile data (see register
  // flow / requirements §4.4). 五十音順 sorting relies on kana being ひらがな.
  familyName: z.string().trim().max(20, '姓は20文字以内で入力してください').nullable(),
  givenName: z.string().trim().max(20, '名は20文字以内で入力してください').nullable(),
  familyKana: z
    .string()
    .trim()
    .max(30, 'せいは30文字以内で入力してください')
    .regex(HIRAGANA_RE, 'せい（ふりがな）はひらがなで入力してください')
    .nullable(),
  givenKana: z
    .string()
    .trim()
    .max(30, 'めいは30文字以内で入力してください')
    .regex(HIRAGANA_RE, 'めい（ふりがな）はひらがなで入力してください')
    .nullable(),
  birthDate: z.union([
    z.string().refine(isRealYmd, '生年月日が正しくありません'),
    z.null(),
  ]),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, '電話番号は数字とハイフンで入力してください')
    .refine((s) => {
      const d = s.replace(/-/g, '')
      return d.length >= 10 && d.length <= 13
    }, '電話番号の桁数が不正です（10〜13桁）')
    .nullable(),
  // 郵便番号はハイフン/空白除去の7桁に正規化保存。
  postalCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v),
    z.union([z.string().regex(/^\d{7}$/, '郵便番号は7桁で入力してください'), z.null()]),
  ),
  address1: z.string().trim().max(100, '住所は100文字以内で入力してください').nullable(),
  address2: z.string().trim().max(100, '建物名・部屋番号は100文字以内で入力してください').nullable(),
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
    familyName: formEntryOrNull(formData.get('familyName')),
    givenName: formEntryOrNull(formData.get('givenName')),
    familyKana: formEntryOrNull(formData.get('familyKana')),
    givenKana: formEntryOrNull(formData.get('givenKana')),
    birthDate: formEntryOrNull(formData.get('birthDate')),
    phone: formEntryOrNull(formData.get('phone')),
    postalCode: formEntryOrNull(formData.get('postalCode')),
    address1: formEntryOrNull(formData.get('address1')),
    address2: formEntryOrNull(formData.get('address2')),
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
      familyName: data.familyName,
      givenName: data.givenName,
      familyKana: data.familyKana,
      givenKana: data.givenKana,
      birthDate: data.birthDate,
      phone: data.phone,
      postalCode: data.postalCode,
      address1: data.address1,
      address2: data.address2,
      updatedAt: new Date(),
    })
    .where(eq(users.id, data.userId))

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${data.userId}/edit`)
  return { success: true }
}

const updateNameSchema = z.object({
  userId: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, '名前を入力してください')
    .max(50, '名前は50文字以内で入力してください'),
})

export type UpdateNameState = {
  error?: string
  success?: boolean
}

/**
 * Rename a member who has NOT linked LINE yet (誤登録リカバリ①).
 *
 * Targets are restricted to plain `member` rows — without that, a vice_admin
 * could relabel an unlinked admin / vice_admin row (users.name is the
 * identity label shown in /self-identify), which is outside this feature's
 * "fix a mistaken registration" scope. The preconditions live in the
 * UPDATE's WHERE clause, so a concurrent /self-identify claim can't slip
 * through between a check and the write — same single-statement race guard
 * as the claim itself. Zero rows means the member got linked, is a
 * privileged role, or doesn't exist, and we refuse.
 */
export async function updateMemberName(
  _prev: UpdateNameState,
  formData: FormData,
): Promise<UpdateNameState> {
  await assertAdminSession()

  const rawName = formData.get('name')
  const parsed = updateNameSchema.safeParse({
    userId: formData.get('userId'),
    name: typeof rawName === 'string' ? rawName : '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  try {
    const updated = await db
      .update(users)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, parsed.data.userId),
          isNull(users.lineUserId),
          eq(users.role, 'member'),
        ),
      )
      .returning({ id: users.id })
    if (updated.length === 0) {
      return { error: 'LINE 紐付け済みのため変更できません' }
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: '同名の会員が既に存在します（退会済み会員を含む）' }
    }
    throw err
  }

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${parsed.data.userId}/edit`)
  return { success: true }
}

const deleteMemberInputSchema = z.object({ userId: z.string().min(1) })

export type DeleteMemberState = {
  error?: string
}

const DELETE_BLOCKED_ERROR =
  'この会員には関連データがあるか LINE 紐付け済みのため削除できません。退会切替を使ってください'

/**
 * Hard-delete a member row (誤登録リカバリ②) — allowed only when the target
 * is a plain `member`, has no LINE binding, AND no other table references
 * the row.
 *
 * The role restriction keeps this within its "undo a mistaken registration"
 * scope: without it a vice_admin could hard-delete an unlinked admin /
 * vice_admin row and break RBAC. The reference check refuses on ANY
 * referencing row instead of trusting the FK actions: `unlinkLine` clears
 * `lineLinkedAt`, so "unlinked" does not imply "never used", and the CASCADE
 * on event_attendances would otherwise silently erase attendance history.
 * Both preconditions (role + unlinked) sit in the DELETE's WHERE clause so a
 * concurrent /self-identify claim or role change loses the race cleanly
 * (same single-statement guard as updateMemberName).
 */
export async function deleteMember(
  _prev: DeleteMemberState,
  formData: FormData,
): Promise<DeleteMemberState> {
  await assertAdminSession()

  const parsed = deleteMemberInputSchema.safeParse({
    userId: formData.get('userId'),
  })
  if (!parsed.success) {
    return { error: '入力が不正です' }
  }
  const targetId = parsed.data.userId

  const failure = await db.transaction(async (tx) => {
    // 対象行を先に FOR UPDATE でロックする。子テーブルへの FK 挿入は親行の
    // FOR KEY SHARE を取るためこのロックと競合し、本 tx の DELETE 完了まで
    // 待機 → コミット後は FK 違反になる。これで「参照チェック後〜DELETE 前」
    // に参照が増えて CASCADE / SET NULL で静かに消える race を塞ぐ
    // (READ COMMITTED ではチェックの再読み込みだけでは防げない)。
    const locked = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, targetId),
          isNull(users.lineUserId),
          eq(users.role, 'member'),
        ),
      )
      .for('update')
    if (locked.length === 0) {
      // 紐付け済み (race 含む) / admin・vice_admin / 不在。
      return { error: DELETE_BLOCKED_ERROR }
    }

    // users.id を FK 参照する全テーブル (12 カラム / 11 テーブル) の存在チェック。
    // 参照列そのものを select するので各テーブルの PK 形状に依存しない。
    const referenceChecks = [
      () =>
        tx
          .select({ ref: eventAttendances.userId })
          .from(eventAttendances)
          .where(eq(eventAttendances.userId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: events.createdBy })
          .from(events)
          .where(eq(events.createdBy, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: scheduleItems.ownerId })
          .from(scheduleItems)
          .where(eq(scheduleItems.ownerId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: lineChannels.assignedUserId })
          .from(lineChannels)
          .where(eq(lineChannels.assignedUserId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: mailMessages.triagedByUserId })
          .from(mailMessages)
          .where(eq(mailMessages.triagedByUserId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: mailWorkerRuns.triggeredByUserId })
          .from(mailWorkerRuns)
          .where(eq(mailWorkerRuns.triggeredByUserId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: mailWorkerJobs.requestedByUserId })
          .from(mailWorkerJobs)
          .where(eq(mailWorkerJobs.requestedByUserId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: tournamentDrafts.id })
          .from(tournamentDrafts)
          .where(
            or(
              eq(tournamentDrafts.approvedByUserId, targetId),
              eq(tournamentDrafts.rejectedByUserId, targetId),
            ),
          )
          .limit(1),
      () =>
        tx
          .select({ ref: pushSubscriptions.userId })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: accounts.userId })
          .from(accounts)
          .where(eq(accounts.userId, targetId))
          .limit(1),
      () =>
        tx
          .select({ ref: sessions.userId })
          .from(sessions)
          .where(eq(sessions.userId, targetId))
          .limit(1),
    ]

    for (const check of referenceChecks) {
      const rows = await check()
      if (rows.length > 0) {
        return { error: DELETE_BLOCKED_ERROR }
      }
    }

    // 行はロック済みなので条件は変化しないが、防御的に WHERE にも残す。
    const deleted = await tx
      .delete(users)
      .where(
        and(
          eq(users.id, targetId),
          isNull(users.lineUserId),
          eq(users.role, 'member'),
        ),
      )
      .returning({ id: users.id })
    if (deleted.length === 0) {
      return { error: DELETE_BLOCKED_ERROR }
    }
    return null
  })

  if (failure) return failure

  revalidatePath('/admin/members')
  redirect('/admin/members')
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

/**
 * Clear the LINE binding for a member. Admin-only.
 *
 * After this runs, the member's next LINE login routes them through
 * /self-identify again, so they can re-claim (or an admin can claim on
 * their behalf by editing later). We null out `lineLinkedAt` and
 * `lineLinkedMethod` so the audit row shows "未紐付け" instead of a
 * stale timestamp.
 *
 * Non-admin access is rejected — `assertAdminSession` accepts `vice_admin`
 * too, but this action is deliberately stricter (only `admin`), matching the
 * plan's specification for audit-sensitive operations.
 */
export async function unlinkLine(formData: FormData) {
  const session = await auth()
  if (session?.user?.role !== 'admin') throw new Error('forbidden')

  const parsed = unlinkLineInputSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) throw new Error('invalid_input')

  await db
    .update(users)
    .set({
      lineUserId: null,
      lineLinkedAt: null,
      lineLinkedMethod: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, parsed.data.userId))

  revalidatePath(`/admin/members/${parsed.data.userId}/edit`)
  revalidatePath('/admin/members')
}
