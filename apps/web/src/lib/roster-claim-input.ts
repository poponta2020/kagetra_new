import { isSchoolYearForKind } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'
import { validateBirthDate, validatePhone } from './profile-validators'

/**
 * roster-claim: `/register/[token]` と `/self-identify` の両方から共通で使う
 * 「名簿候補」の表示用の形。DB の実列（phone・birthDate）は載せず、未入力
 * かどうかの真偽値だけを持つ（未紐付け LINE user に PII を開示しない）。
 */
export type RosterCandidate = {
  id: string
  name: string | null
  needsPhone: boolean
  needsBirthDate: boolean
}

export type RosterClaimValues = {
  isCircleMember: boolean
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
  phone: string | null
  birthDate: string | null
}

function strOf(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' ? raw : ''
}

// HTML checkboxes only submit a value when checked; absence (or an explicit
// "false") means unchecked. Mirrors registerViaInvite's isChecked.
function isChecked(raw: FormDataEntryValue | null): boolean {
  return typeof raw === 'string' && raw.length > 0 && raw !== 'false'
}

/**
 * roster-claim フォームの「サークル所属」ブロックを検証する。
 *
 * `needs` は DB からロックして得た印（電話・生年月日が未入力かどうか）を
 * 渡す前提 — クライアントが送ってきた値ではなく、呼び出し元
 * (`claimRosterMember`) がトランザクション内で決めた値を使うこと。
 *
 * サークル所属 OFF のときは、送られてきた学部属性・電話・生年月日を
 * すべて無視して null を返す（needs が true でも要求しない）。
 */
export function parseRosterClaimInput(
  formData: FormData,
  needs: { needsPhone: boolean; needsBirthDate: boolean },
): { data: RosterClaimValues } | { error: string } {
  const isCircleMember = isChecked(formData.get('isCircleMember'))

  if (!isCircleMember) {
    return {
      data: {
        isCircleMember: false,
        facultyKind: null,
        faculty: null,
        schoolYear: null,
        phone: null,
        birthDate: null,
      },
    }
  }

  const fk = strOf(formData.get('facultyKind')).trim()
  if (fk !== 'undergraduate' && fk !== 'graduate') {
    return { error: '所属（学部／大学院）を選択してください' }
  }
  const facultyKind = fk as FacultyKind

  const fac = strOf(formData.get('faculty')).trim()
  if (fac.length === 0) return { error: '学部等名を入力してください' }
  if (fac.length > 50) return { error: '学部等名は50文字以内で入力してください' }

  const sy = strOf(formData.get('schoolYear')).trim()
  if (sy.length === 0 || !isSchoolYearForKind(sy, facultyKind)) {
    return { error: '学年を選択してください' }
  }

  let birthDate: string | null = null
  if (needs.needsBirthDate) {
    const bd = strOf(formData.get('birthDate')).trim()
    const bdError = validateBirthDate(bd)
    if (bdError) return { error: bdError }
    birthDate = bd
  }

  let phone: string | null = null
  if (needs.needsPhone) {
    const ph = strOf(formData.get('phone')).trim()
    const phError = validatePhone(ph)
    if (phError) return { error: phError }
    phone = ph
  }

  return {
    data: {
      isCircleMember: true,
      facultyKind,
      faculty: fac,
      schoolYear: sy,
      phone,
      birthDate,
    },
  }
}
