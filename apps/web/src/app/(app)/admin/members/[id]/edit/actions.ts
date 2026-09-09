'use server'

import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation, uniqueViolationConstraint } from '@/lib/db-errors'
import {
  accounts,
  entryGroupPaymentNotices,
  eventAttendances,
  events,
  lineChannels,
  mailMessages,
  mailWorkerJobs,
  mailWorkerRuns,
  pushSubscriptions,
  sessions,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'
import { isSchoolYearForKind, isValidSchoolYear } from '@kagetra/shared'
// 名簿の列の**形式検証**は lib/member-profile-fields.ts が正典（会員編集・招待登録・
// 年度確認の行内修正が同じ列へ書くため、規則を1箇所に集めている）。必須／任意の
// 判断はここ（管理者編集＝全項目任意）に残す。
import {
  MEMBER_GENDERS,
  MEMBER_GRADES,
  formEntryOrNull,
  memberProfileFieldSchemas as f,
} from '@/lib/member-profile-fields'
import type { FacultyKind } from '@kagetra/shared/types'

const GRADES = MEMBER_GRADES
const GENDERS = MEMBER_GENDERS
const READER_CERTIFICATIONS = ['B', 'A'] as const

const unlinkLineInputSchema = z.object({ userId: z.string().min(1) })

const updateProfileSchema = z.object({
  userId: z.string().min(1),
  grade: f.grade,
  gender: f.gender,
  affiliation: z.string().max(255).nullable(),
  dan: f.dan,
  zenNichikyo: z.boolean(),
  // invite-register-redesign: 構造化氏名＋全日協 PII（admin/vice_admin が閲覧・編集）。
  // 全て nullable ＝ **管理者編集は「値が来たときだけ形式検証する」**（後から直せる
  // 画面という性質）。「サークル所属 ON なら必須」等の必須強制は自己登録フローと
  // 年度確認の「登録する」だけが行う。`name`（合成表示名）はここでは再合成しない。
  familyName: f.familyName,
  givenName: f.givenName,
  familyKana: f.familyKana,
  givenKana: f.givenKana,
  birthDate: f.birthDate,
  phone: f.phone,
  postalCode: f.postalCode,
  address1: f.address1,
  address2: f.address2,
  // travel-report R1: サークル所属と学部属性。
  isCircleMember: z.boolean(),
  facultyKind: z.enum(['undergraduate', 'graduate']).nullable(),
  faculty: z.string().trim().max(50, '学部等名は50文字以内で入力してください').nullable(),
  schoolYear: z.string().trim().nullable(),
  // annual-registration-renewal R11: 全日協の公認資格。申請で決まる値なので
  // **管理者だけが編集**する（本人は年度確認 S1 で読むだけ）。読手の「なし」は
  // enum 値ではなく列の NULL（未選択と同義にする＝3値目を作らない）。
  readerCertification: z.enum(READER_CERTIFICATIONS).nullable(),
  isAssociateReferee: z.boolean(),
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
    isCircleMember: formData.get('isCircleMember') === 'on',
    facultyKind: formEntryOrNull(formData.get('facultyKind')),
    faculty: formEntryOrNull(formData.get('faculty')),
    schoolYear: formEntryOrNull(formData.get('schoolYear')),
    readerCertification: formEntryOrNull(formData.get('readerCertification')),
    isAssociateReferee: formData.get('isAssociateReferee') === 'on',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }
  const data = parsed.data

  // travel-report R1（サーバー不変条件）: サークル所属 OFF のときは学部属性を
  // 「任意・既存値は保持する（消さない）」— OFF で送信された学部属性は
  // フォームが畳んで送っていないだけの空値であり、意図した削除ではないため
  // 触らない。ON のときだけ書き込み対象に含める。
  const circleFieldsToWrite: {
    facultyKind?: (typeof data)['facultyKind']
    faculty?: (typeof data)['faculty']
    schoolYear?: (typeof data)['schoolYear']
  } = {}
  if (data.isCircleMember) {
    // travel-report R1/AC-4: 学年は選択のみ。区分が分かっていればそれと整合
    // する値だけを受け付け、区分が未入力なら全区分の候補から検証する。
    if (data.schoolYear !== null) {
      const ok = data.facultyKind
        ? isSchoolYearForKind(data.schoolYear, data.facultyKind as FacultyKind)
        : isValidSchoolYear(data.schoolYear)
      if (!ok) return { error: '学年が不正です' }
    }
    circleFieldsToWrite.facultyKind = data.facultyKind
    circleFieldsToWrite.faculty = data.faculty
    circleFieldsToWrite.schoolYear = data.schoolYear
  }

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
      isCircleMember: data.isCircleMember,
      ...circleFieldsToWrite,
      readerCertification: data.readerCertification,
      isAssociateReferee: data.isAssociateReferee,
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
        // 振込連絡の最終送信者。ON DELETE SET NULL だが、送信者を消すと
        // 「誰が最後に送ったか」の監査情報が不可逆に失われるため、他の
        // 参照と同様にここで拒否する（line-bot-message-revamp §3.3）。
        tx
          .select({ ref: entryGroupPaymentNotices.lastSentBy })
          .from(entryGroupPaymentNotices)
          .where(eq(entryGroupPaymentNotices.lastSentBy, targetId))
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
 *
 * The TARGET is restricted to plain `member` rows (member-role-management).
 * `updateMemberRole` refuses to promote an unlinked row precisely because
 * `/self-identify` offers every unlinked+invited row as a claimable identity
 * without looking at `role` — but unlinking an already-promoted row would
 * produce the same dangerous state through the back door (and the two actions
 * racing each other would too). The restriction lives in the UPDATE's WHERE
 * clause so a concurrent role change is re-evaluated against the committed
 * role rather than a stale read. To unlink an admin / vice_admin, demote them
 * to `member` first.
 */
export async function unlinkLine(formData: FormData) {
  const session = await auth()
  if (session?.user?.role !== 'admin') throw new Error('forbidden')

  const parsed = unlinkLineInputSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) throw new Error('invalid_input')

  const updated = await db
    .update(users)
    .set({
      lineUserId: null,
      lineLinkedAt: null,
      lineLinkedMethod: null,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, parsed.data.userId), eq(users.role, 'member')))
    .returning({ id: users.id })

  if (updated.length === 0) {
    // 0 行 = 不在 または 権限持ち。不在は従来どおり無害に返す（誤った
    // userId で画面を壊さない既存契約）。UPDATE は既に確定しているので、
    // ここでの再読み込みは「なぜ効かなかったか」の判別にしか使わない。
    const row = await db.query.users.findFirst({
      where: eq(users.id, parsed.data.userId),
      columns: { role: true },
    })
    if (row && row.role !== 'member') throw new Error('privileged_role')
  }

  revalidatePath(`/admin/members/${parsed.data.userId}/edit`)
  revalidatePath('/admin/members')
}

// guest-role: 4択（管理者 / 副管理者 / 一般会員 / ゲスト）。ゲストは登録会の
// 移動に対応するため一般会員と双方向に変更できる（requirements R7）。
const ROLES = ['admin', 'vice_admin', 'member', 'guest'] as const

const updateRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLES),
})

export type UpdateRoleState = {
  error?: string
  success?: boolean
}

/**
 * admin / vice_admin への変更だけを「昇格」として追加条件を課す。
 *
 * guest-role: `guest` はここに含めない。既存の昇格制限（LINE 紐付け必須・
 * 退会済み不可）は「権限を持つ行を第三者に名乗られない」ための防御であり、
 * ゲストは権限を持たないので同じ制限を課す理由がない（requirements §7）。
 * ゲストは `member` と同じ「制限なしで変更できる側」に置く。
 */
function isPrivilegedRole(role: (typeof ROLES)[number]): boolean {
  return role === 'admin' || role === 'vice_admin'
}

/**
 * Change a member's role (member-role-management).
 *
 * `admin` only — `assertAdminSession` accepts `vice_admin`, and reusing it here
 * would let a vice_admin promote themselves to `admin`, collapsing the 3-tier
 * RBAC. Same reasoning as `unlinkLine`.
 *
 * The check reads the EFFECTIVE role (`session.user.role`), not `realRole`, so
 * an admin previewing as 一般会員 (role-preview-switch) cannot change roles —
 * that is the point of the preview. Every other authorization in the app reads
 * the effective role too.
 *
 * Refusals (all enforced server-side, see requirements §3.2 R3):
 *   - the caller's own row — a mis-click that drops your own admin rights is
 *     only recoverable via direct DB access
 *   - promoting a row with no LINE binding — `/self-identify` offers every
 *     unlinked+invited row as a claimable identity WITHOUT looking at `role`,
 *     so an unlinked admin row can be claimed by whoever opens an invite link
 *   - promoting a deactivated row — they cannot log in, and it arms a
 *     privileged row for a future reactivation
 *   - leaving zero ACTIVE admins — a deactivated admin cannot log in
 *     (`signIn` rejects them), so counting them would still lock everyone out
 */
export async function updateMemberRole(
  _prev: UpdateRoleState,
  formData: FormData,
): Promise<UpdateRoleState> {
  const session = await auth()
  if (session?.user?.role !== 'admin') throw new Error('forbidden')

  const parsed = updateRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { error: '入力が不正です' }
  }
  const { userId: targetId, role: nextRole } = parsed.data

  if (targetId === session.user.id) {
    return { error: 'ご自身のロールは変更できません' }
  }

  const failure = await db.transaction(async (tx) => {
    // ロックは常に「有効な管理者の集合 → 対象行」の順で取る。2つの
    // ロール変更が同時に走っても、この順序が固定なら互いに待つだけで
    // デッドロックにならず、「変更後に有効な管理者が 0 人」の判定が
    // 直列化される (行を数えるだけでは READ COMMITTED で防げない)。
    const activeAdmins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), isNull(users.deactivatedAt)))
      .for('update')

    const targetRows = await tx
      .select({
        id: users.id,
        role: users.role,
        lineUserId: users.lineUserId,
        deactivatedAt: users.deactivatedAt,
      })
      .from(users)
      .where(eq(users.id, targetId))
      .for('update')
    const target = targetRows[0]
    if (!target) {
      return { error: '対象の会員が見つかりません' }
    }

    // 同じロールの保存は no-op として成功扱いにする (エラーにしない)。
    if (target.role === nextRole) {
      return null
    }

    if (isPrivilegedRole(nextRole)) {
      if (target.lineUserId == null) {
        return {
          error:
            'LINE 紐付け前の会員は管理者・副管理者にできません。紐付け後に変更してください',
        }
      }
      if (target.deactivatedAt != null) {
        return { error: '退会済みの会員は管理者・副管理者にできません' }
      }
    }

    // 有効な管理者を 0 人にする変更を拒否する。呼び出し元自身が有効な
    // admin である以上、自分以外を降格しても 0 人にはならない = 通常は
    // 到達しない多重防御。自己変更の禁止が将来ゆるんでもここが残る。
    if (target.role === 'admin' && target.deactivatedAt == null) {
      const remaining = activeAdmins.filter((row) => row.id !== targetId).length
      if (remaining === 0) {
        return { error: '有効な管理者がいなくなるため変更できません' }
      }
    }

    // 行はロック済みなので条件は変化しないが、防御的に WHERE にも残す
    // (deleteMember / updateMemberName と同じ形)。昇格の前提 (紐付け済み・
    // 有効) も条件に含める: 対象行の FOR UPDATE により unlinkLine や退会
    // 切替とは既に直列化されているが、この 2 つは「昇格を成立させてよいか」
    // の判断根拠そのものなので、読み取り時点ではなく書き込み時点の値で
    // 効かせておく。
    const conditions = [eq(users.id, targetId), eq(users.role, target.role)]
    if (isPrivilegedRole(nextRole)) {
      conditions.push(isNotNull(users.lineUserId), isNull(users.deactivatedAt))
    }
    const updated = await tx
      .update(users)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: users.id })
    if (updated.length === 0) {
      return { error: 'ロールを変更できませんでした' }
    }
    return null
  })

  if (failure) return failure

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${targetId}/edit`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// line-bot-message-revamp: 会計フラグ（users.is_treasurer）
// ---------------------------------------------------------------------------

const updateTreasurerSchema = z.object({
  userId: z.string().min(1),
  // チェックボックス未チェックの form 送信ではキー自体が来ないため、
  // 'on' / null の2値で受ける（hidden input を挟まない素直な form で扱える）。
  isTreasurer: z.boolean(),
})

export type UpdateTreasurerState = {
  error?: string
  success?: boolean
}

/**
 * 会計フラグの切り替え（requirements §3.1.2）。
 *
 * ★この列は「@会計 で誰をメンションするか」の識別**専用**で、認可判断には
 * 一切使わない（§6）。したがってここでのガードは既存の会員編集と同じ
 * `assertAdminSession`（admin / vice_admin）で足りる — ロール変更のような
 * 権限昇格を伴わないため、`updateMemberRole` の admin 限定ガードには揃えない。
 *
 * 退会済み・LINE 未紐付けの会員にも立てられる（メンション対象の解決側が
 * `line_user_id IS NOT NULL AND deactivated_at IS NULL` で絞るので、
 * フラグ自体の付け外しを制限すると「復帰したら会計に戻す」運用が壊れる）。
 */
export async function updateMemberTreasurer(
  _prev: UpdateTreasurerState,
  formData: FormData,
): Promise<UpdateTreasurerState> {
  await assertAdminSession()

  const parsed = updateTreasurerSchema.safeParse({
    userId: formData.get('userId'),
    isTreasurer: formData.get('isTreasurer') === 'on',
  })
  if (!parsed.success) {
    return { error: '入力が不正です' }
  }
  const { userId, isTreasurer } = parsed.data

  const updated = await db
    .update(users)
    .set({ isTreasurer, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id })
  if (updated.length === 0) {
    return { error: '対象の会員が見つかりません' }
  }

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${userId}/edit`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// travel-report: 副連絡責任者・サークル長（users.is_travel_report_submitter /
// users.is_circle_leader）
// ---------------------------------------------------------------------------

const updateTravelFlagsSchema = z.object({
  userId: z.string().min(1),
  isTravelReportSubmitter: z.boolean(),
  isCircleLeader: z.boolean(),
})

export type UpdateTravelFlagsState = {
  error?: string
  success?: boolean
}

/**
 * 副連絡責任者・サークル長フラグの切り替え（requirements R2）。会計フラグと
 * 同じ「会員編集で admin / vice_admin が付け外しする」流儀の1フォームだが、
 * 中身の扱いは会計と対照的:
 *
 * - `isTravelReportSubmitter`（副連絡責任者）: `is_treasurer` と違い**認可に
 *   使う**（遠征届の操作権限そのもの・requirements §7）。判定の正典は
 *   `lib/travel-report/authz.ts`（別タスクが実装）で、そこが role='guest' を
 *   弾くため付与しても権限にはならないが、意味のないフラグを保存させない
 *   ためここでも拒否する（UI 側も role='guest' の対象にはチェックボックスを
 *   出さない — member-travel-flags-section.tsx）。
 * - `isCircleLeader`（サークル長）は**同時に1人だけ**（partial unique index
 *   `users_circle_leader_unique` が DB バックストップ）。2 フラグを**1回の
 *   UPDATE**で更新することで、サークル長の重複が拒否されたときに
 *   副連絡責任者だけが先に変更済みになる事態を防ぐ（AC-5: 「エラーになり、
 *   変更されない」）。
 */
export async function updateMemberTravelFlags(
  _prev: UpdateTravelFlagsState,
  formData: FormData,
): Promise<UpdateTravelFlagsState> {
  await assertAdminSession()

  const parsed = updateTravelFlagsSchema.safeParse({
    userId: formData.get('userId'),
    isTravelReportSubmitter: formData.get('isTravelReportSubmitter') === 'on',
    isCircleLeader: formData.get('isCircleLeader') === 'on',
  })
  if (!parsed.success) {
    return { error: '入力が不正です' }
  }
  const { userId, isTravelReportSubmitter, isCircleLeader } = parsed.data

  const target = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  })
  if (!target) {
    return { error: '対象の会員が見つかりません' }
  }
  if (isTravelReportSubmitter && target.role === 'guest') {
    return { error: 'ゲストには副連絡責任者を付与できません' }
  }

  try {
    const updated = await db
      .update(users)
      .set({ isTravelReportSubmitter, isCircleLeader, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
    if (updated.length === 0) {
      return { error: '対象の会員が見つかりません' }
    }
  } catch (err) {
    if (
      isUniqueViolation(err) &&
      (uniqueViolationConstraint(err) ?? '').includes('users_circle_leader_unique')
    ) {
      return {
        error: 'サークル長は既に他の会員に設定されています。先に外してから設定してください',
      }
    }
    throw err
  }

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${userId}/edit`)
  return { success: true }
}
