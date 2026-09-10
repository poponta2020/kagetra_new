'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { isGuestRole } from '@/lib/guest-access'
import {
  formEntryOrNull,
  memberProfileFieldSchemas as f,
} from '@/lib/member-profile-fields'
import { isValidSchoolYear, isSchoolYearForKind } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'
import { saveRenewalAnswer } from '@/lib/membership-renewal/store'
import type { SchoolYearAnswerInput } from '@/lib/membership-renewal/store'

/**
 * S1（`/renewal`）の回答 Server Action。
 *
 * 認可は「ログイン会員本人」だけ（R12・AC-9）。`renewalId` と `userId` は
 * フォームから受け取らず**セッションから決める** —— 他人の id を送っても
 * 他人の回答は書けない。store 側も `user_id` を WHERE に含めるので二重に塞がる。
 * ゲストは対象外（`/renewal` をゲスト許可リストに入れない）。
 */

export type RenewalAnswerState = {
  error?: string
  missingFields?: string[]
  success?: boolean
}

/** 名簿の列の修正。形式検証は `member-profile-fields.ts` が正典（二重定義しない）。 */
const rosterPatchSchema = z.object({
  familyName: f.familyName,
  givenName: f.givenName,
  familyKana: f.familyKana,
  givenKana: f.givenKana,
  birthDate: f.birthDate,
  gender: f.gender,
  dan: f.dan,
  grade: f.grade,
  postalCode: f.postalCode,
  address1: f.address1,
  address2: f.address2,
  phone: f.phone,
})

const answerSchema = z.enum(['register', 'not_register'])
const schoolYearKindSchema = z.enum(['advance', 'custom', 'leave'])

export async function submitRenewalAnswer(
  _prev: RenewalAnswerState,
  formData: FormData,
): Promise<RenewalAnswerState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId || isGuestRole(session?.user?.role)) {
    return { error: 'この操作を行う権限がありません' }
  }

  const renewalIdRaw = formData.get('renewalId')
  const renewalId = typeof renewalIdRaw === 'string' ? Number.parseInt(renewalIdRaw, 10) : NaN
  if (!Number.isInteger(renewalId)) return { error: '入力が不正です' }

  const answerRaw = formEntryOrNull(formData.get('answer'))
  let answer: 'register' | 'not_register' | undefined
  if (answerRaw !== null) {
    const parsed = answerSchema.safeParse(answerRaw)
    if (!parsed.success) return { error: '入力が不正です' }
    answer = parsed.data
  }

  // 名簿の修正は「登録する」のときだけ受け取る（「登録しない」で畳んだ列を
  // 空値として送ってしまい、既存の値を消す事故を防ぐ）。
  let rosterPatch: z.infer<typeof rosterPatchSchema> | undefined
  if (answer === 'register') {
    const parsed = rosterPatchSchema.safeParse({
      familyName: formEntryOrNull(formData.get('familyName')),
      givenName: formEntryOrNull(formData.get('givenName')),
      familyKana: formEntryOrNull(formData.get('familyKana')),
      givenKana: formEntryOrNull(formData.get('givenKana')),
      birthDate: formEntryOrNull(formData.get('birthDate')),
      gender: formEntryOrNull(formData.get('gender')),
      dan: formData.get('dan'),
      grade: formEntryOrNull(formData.get('grade')),
      postalCode: formEntryOrNull(formData.get('postalCode')),
      address1: formEntryOrNull(formData.get('address1')),
      address2: formEntryOrNull(formData.get('address2')),
      phone: formEntryOrNull(formData.get('phone')),
    })
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
    }
    rosterPatch = parsed.data
  }

  const schoolYear = parseSchoolYearAnswer(formData)
  if (schoolYear && 'error' in schoolYear) return { error: schoolYear.error }

  if (!answer && !schoolYear) return { error: '回答が選択されていません' }

  const result = await saveRenewalAnswer({
    renewalId,
    userId,
    actorUserId: userId,
    byAdmin: false,
    ...(answer ? { answer } : {}),
    ...(rosterPatch ? { rosterPatch } : {}),
    ...(schoolYear ? { schoolYear } : {}),
  })
  if ('error' in result) {
    return { error: result.error, missingFields: result.missingFields }
  }

  revalidatePath('/renewal')
  revalidatePath('/dashboard')
  revalidatePath('/admin/members/renewal')
  return { success: true }
}

/**
 * 学年セクションの回答をフォームから取り出す。未回答なら `undefined`。
 * 学年の値は**選択のみ**（既存の会員編集・登録フローと同じ規則で
 * `isValidSchoolYear` / `isSchoolYearForKind` を通す）。
 */
function parseSchoolYearAnswer(
  formData: FormData,
): SchoolYearAnswerInput | { error: string } | undefined {
  const kindRaw = formEntryOrNull(formData.get('schoolYearKind'))
  if (kindRaw === null) return undefined
  const parsedKind = schoolYearKindSchema.safeParse(kindRaw)
  if (!parsedKind.success) return { error: '入力が不正です' }
  const schoolYearKind = parsedKind.data

  if (schoolYearKind === 'leave') {
    // 卒業・サークルを離れる。学年・学部は保存しない（4/1 に is_circle_member
    // だけを false にする。学部等名・学年は残す）。
    return { schoolYearKind }
  }

  const nextSchoolYear = formEntryOrNull(formData.get('nextSchoolYear'))
  if (!nextSchoolYear) return { error: '4月からの学年を選んでください' }

  const nextFacultyKindRaw = formEntryOrNull(formData.get('nextFacultyKind'))
  let nextFacultyKind: FacultyKind | null = null
  if (nextFacultyKindRaw !== null) {
    if (nextFacultyKindRaw !== 'undergraduate' && nextFacultyKindRaw !== 'graduate') {
      return { error: '所属が不正です' }
    }
    nextFacultyKind = nextFacultyKindRaw
  }
  const nextFaculty = formEntryOrNull(formData.get('nextFaculty'))
  if (nextFacultyKind && !nextFaculty) return { error: '学部等名を入力してください' }
  if (nextFaculty && nextFaculty.length > 50) {
    return { error: '学部等名は50文字以内で入力してください' }
  }

  const ok = nextFacultyKind
    ? isSchoolYearForKind(nextSchoolYear, nextFacultyKind)
    : isValidSchoolYear(nextSchoolYear)
  if (!ok) return { error: '学年が不正です' }

  return { schoolYearKind, nextFacultyKind, nextFaculty, nextSchoolYear }
}
