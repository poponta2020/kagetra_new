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
import { isSchoolYearForKind } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
const GENDERS = ['male', 'female'] as const
// ひらがな（小書き・濁点合成済み）＋長音記号 ー のみ。漢字/カタカナ/英数は弾く。
const HIRAGANA_RE = /^[ぁ-ゖー]+$/
const PHONE_RE = /^[0-9-]+$/

// Structured-name + grade schema (always-required core). Unlike createMember
// (single `name`, A–E), invite registration collects 姓/名×漢字/かな and derives
// the canonical `name` by 合成. PII (段位・全日協登録情報) is validated
// conditionally below since its requiredness depends on grade + zenNichikyo.
const coreSchema = z.object({
  familyName: z
    .string()
    .trim()
    .min(1, '姓（漢字）を入力してください')
    .max(20, '姓（漢字）は20文字以内で入力してください'),
  givenName: z
    .string()
    .trim()
    .min(1, '名（漢字）を入力してください')
    .max(20, '名（漢字）は20文字以内で入力してください'),
  familyKana: z
    .string()
    .trim()
    .min(1, 'せい（ふりがな）を入力してください')
    .max(30, 'せい（ふりがな）は30文字以内で入力してください')
    .regex(HIRAGANA_RE, 'せい（ふりがな）はひらがなで入力してください'),
  givenKana: z
    .string()
    .trim()
    .min(1, 'めい（ふりがな）を入力してください')
    .max(30, 'めい（ふりがな）は30文字以内で入力してください')
    .regex(HIRAGANA_RE, 'めい（ふりがな）はひらがなで入力してください'),
  grade: z.enum(GRADES).nullable(),
})

type RegistrationValues = {
  name: string
  familyName: string
  givenName: string
  familyKana: string
  givenKana: string
  grade: (typeof GRADES)[number] | null
  dan: number | null
  zenNichikyo: boolean
  gender: (typeof GENDERS)[number] | null
  birthDate: string | null
  phone: string | null
  postalCode: string | null
  address1: string | null
  address2: string | null
  // travel-report R1: サークル所属と学部属性。
  isCircleMember: boolean
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
}

// guest-role: guest registration collects only 3 fields — no structured name,
// no PII. `grade` is required here (unlike the member flow's nullable grade)
// since 対象級判定 needs it for every guest.
type GuestRegistrationValues = {
  name: string
  grade: (typeof GRADES)[number]
  affiliation: string
  // travel-report R1/AC-2: ゲストもサークル所属 ON なら姓・名（漢字のみ・かな不要）
  // と学部属性・電話・生年月日が必要になる。
  isCircleMember: boolean
  familyName: string | null
  givenName: string | null
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
  phone: string | null
  birthDate: string | null
}

function strOf(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' ? raw : ''
}

function gradeEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

// HTML checkboxes only submit a value when checked; absence (or an explicit
// "false") means unchecked.
function isChecked(raw: FormDataEntryValue | null): boolean {
  return typeof raw === 'string' && raw.length > 0 && raw !== 'false'
}

// 'YYYY-MM-DD', a real calendar date, year ≥ 1900, not in the future.
function validateBirthDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '生年月日を入力してください'
  const parts = s.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return '生年月日が正しくありません'
  }
  if (y < 1900) return '生年月日が正しくありません'
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (dt.getTime() > todayUtc) return '生年月日に未来の日付は指定できません'
  return null
}

/**
 * Validate the register form and produce the row to persist, enforcing the
 * server-side invariants from requirements §3.1 independently of what the
 * client chose to show/hide:
 *   - grade ≠ A          → dan = null
 *   - grade ∉ {A,B,C}    → zenNichikyo = false (全日協 is only offered A/B/C)
 *   - zenNichikyo = false かつ isCircleMember = false → gender/birth/phone/postal/address = null
 * PII is all-required when zenNichikyo is on, except address2 (DB-nullable; the
 * front enforces it via the 戸建て checkbox). Messages are field-specific.
 *
 * travel-report R1/AC-1/AC-3: サークル所属 ON のとき 学部区分・学部等名・学年・
 * 電話・生年月日 が必須になる。電話・生年月日は全日協用と**同一の列**を共用する
 * ため、zenNichikyo と isCircleMember の**どちらか一方でも該当すれば必須**
 * （どちらも false のときだけ null に強制する）。学部区分・学部等名・学年は
 * isCircleMember 専用で全日協とは独立。
 */
function parseRegistration(
  formData: FormData,
): { data: RegistrationValues } | { error: string } {
  const base = coreSchema.safeParse({
    familyName: strOf(formData.get('familyName')),
    givenName: strOf(formData.get('givenName')),
    familyKana: strOf(formData.get('familyKana')),
    givenKana: strOf(formData.get('givenKana')),
    grade: gradeEntryOrNull(formData.get('grade')),
  })
  if (!base.success) {
    return { error: base.error.issues[0]?.message ?? '入力が不正です' }
  }
  const { familyName, givenName, familyKana, givenKana, grade } = base.data
  // 表示名は合成名で一元化（UNIQUE / self-identify 照合は name が正典）。半角スペース1つ。
  const name = `${familyName} ${givenName}`

  // 段位: A級のみ必須（四〜八段 = 4〜8）。それ以外は null に強制。
  let dan: number | null = null
  if (grade === 'A') {
    const raw = strOf(formData.get('dan')).trim()
    const n = Number(raw)
    if (raw === '' || !Number.isInteger(n) || n < 4 || n > 8) {
      return { error: '段位を選択してください（四〜八段）' }
    }
    dan = n
  }

  // 全日協: A/B/C のみ登録可。null/D/E は提出値に関わらず false に強制。
  const gradeAllowsZen = grade === 'A' || grade === 'B' || grade === 'C'
  const zenNichikyo = gradeAllowsZen && isChecked(formData.get('zenNichikyo'))

  // travel-report R1: サークル所属。真偽属性で級には依存しない。
  const isCircleMember = isChecked(formData.get('isCircleMember'))

  let gender: (typeof GENDERS)[number] | null = null
  let birthDate: string | null = null
  let phone: string | null = null
  let postalCode: string | null = null
  let address1: string | null = null
  let address2: string | null = null
  let facultyKind: FacultyKind | null = null
  let faculty: string | null = null
  let schoolYear: string | null = null

  if (isCircleMember) {
    const fk = strOf(formData.get('facultyKind')).trim()
    if (fk === 'undergraduate' || fk === 'graduate') {
      facultyKind = fk
    } else {
      return { error: '所属（学部／大学院）を選択してください' }
    }

    const fac = strOf(formData.get('faculty')).trim()
    if (fac.length === 0) return { error: '学部等名を入力してください' }
    if (fac.length > 50) return { error: '学部等名は50文字以内で入力してください' }
    faculty = fac

    // 学年は選択のみ（候補外は拒否）。区分と整合しない学年（学部に「修士1年」等）も拒否する。
    const sy = strOf(formData.get('schoolYear')).trim()
    if (sy.length === 0 || !isSchoolYearForKind(sy, facultyKind)) {
      return { error: '学年を選択してください' }
    }
    schoolYear = sy
  }

  if (zenNichikyo) {
    const g = strOf(formData.get('gender')).trim()
    if (g !== 'male' && g !== 'female') return { error: '性別を選択してください' }
    gender = g
  }

  // 電話・生年月日は全日協用の列と共用。全日協 ON とサークル所属 ON の
  // どちらか一方でも該当すれば必須（入力欄は1つ）。
  if (zenNichikyo || isCircleMember) {
    const bd = strOf(formData.get('birthDate')).trim()
    const bdError = validateBirthDate(bd)
    if (bdError) return { error: bdError }
    birthDate = bd

    const ph = strOf(formData.get('phone')).trim()
    if (!PHONE_RE.test(ph)) {
      return { error: '電話番号は数字とハイフンで入力してください' }
    }
    const digits = ph.replace(/-/g, '')
    if (digits.length < 10 || digits.length > 13) {
      return { error: '電話番号の桁数が不正です（10〜13桁）' }
    }
    phone = ph
  }

  if (zenNichikyo) {
    // 郵便番号は7桁に正規化（ハイフン/空白除去）して保存。
    const pc = strOf(formData.get('postalCode')).replace(/[\s-]/g, '')
    if (!/^\d{7}$/.test(pc)) return { error: '郵便番号は7桁で入力してください' }
    postalCode = pc

    const a1 = strOf(formData.get('address1')).trim()
    if (a1.length < 1 || a1.length > 100) {
      return { error: '住所（丁目・番地まで）を入力してください' }
    }
    address1 = a1

    // 住所2 はサーバー任意（フロントが戸建てチェックで必須を担保）。空は null。
    const a2 = strOf(formData.get('address2')).trim()
    if (a2.length > 100) {
      return { error: '建物名・部屋番号は100文字以内で入力してください' }
    }
    address2 = a2.length === 0 ? null : a2
  }

  return {
    data: {
      name,
      familyName,
      givenName,
      familyKana,
      givenKana,
      grade,
      dan,
      zenNichikyo,
      gender,
      birthDate,
      phone,
      postalCode,
      address1,
      address2,
      isCircleMember,
      facultyKind,
      faculty,
      schoolYear,
    },
  }
}

/**
 * guest-role: 3-field guest registration (表示名・級・所属会, all required —
 * requirements §R1/R8). No structured name/かな, no 全日協 PII. `grade` is
 * required (not nullable, unlike the member flow) since 対象級判定 needs it.
 */
function parseGuestRegistration(
  formData: FormData,
): { data: GuestRegistrationValues } | { error: string } {
  const name = strOf(formData.get('name')).trim()
  if (name.length === 0) return { error: '表示名を入力してください' }
  if (name.length > 50) return { error: '表示名は50文字以内で入力してください' }

  const gradeRaw = gradeEntryOrNull(formData.get('grade'))
  if (gradeRaw === null || !(GRADES as readonly string[]).includes(gradeRaw)) {
    return { error: '級を選択してください' }
  }
  const grade = gradeRaw as (typeof GRADES)[number]

  const affiliation = strOf(formData.get('affiliation')).trim()
  if (affiliation.length === 0) return { error: '所属会を入力してください' }
  if (affiliation.length > 100) return { error: '所属会は100文字以内で入力してください' }

  // travel-report R1/AC-2: サークル所属 ON のゲストは 姓・名（漢字。かな不要）＋
  // 学部区分・学部等名・学年・電話・生年月日 が追加で必須になる。ゲストには
  // 全日協が無いため、電話・生年月日は isCircleMember だけで必須が決まる。
  const isCircleMember = isChecked(formData.get('isCircleMember'))
  let familyName: string | null = null
  let givenName: string | null = null
  let facultyKind: FacultyKind | null = null
  let faculty: string | null = null
  let schoolYear: string | null = null
  let phone: string | null = null
  let birthDate: string | null = null

  if (isCircleMember) {
    const fn = strOf(formData.get('familyName')).trim()
    if (fn.length === 0) return { error: '姓（漢字）を入力してください' }
    if (fn.length > 20) return { error: '姓（漢字）は20文字以内で入力してください' }
    familyName = fn

    const gn = strOf(formData.get('givenName')).trim()
    if (gn.length === 0) return { error: '名（漢字）を入力してください' }
    if (gn.length > 20) return { error: '名（漢字）は20文字以内で入力してください' }
    givenName = gn

    const fk = strOf(formData.get('facultyKind')).trim()
    if (fk === 'undergraduate' || fk === 'graduate') {
      facultyKind = fk
    } else {
      return { error: '所属（学部／大学院）を選択してください' }
    }

    const fac = strOf(formData.get('faculty')).trim()
    if (fac.length === 0) return { error: '学部等名を入力してください' }
    if (fac.length > 50) return { error: '学部等名は50文字以内で入力してください' }
    faculty = fac

    const sy = strOf(formData.get('schoolYear')).trim()
    if (sy.length === 0 || !isSchoolYearForKind(sy, facultyKind)) {
      return { error: '学年を選択してください' }
    }
    schoolYear = sy

    const bd = strOf(formData.get('birthDate')).trim()
    const bdError = validateBirthDate(bd)
    if (bdError) return { error: bdError }
    birthDate = bd

    const ph = strOf(formData.get('phone')).trim()
    if (!PHONE_RE.test(ph)) {
      return { error: '電話番号は数字とハイフンで入力してください' }
    }
    const digits = ph.replace(/-/g, '')
    if (digits.length < 10 || digits.length > 13) {
      return { error: '電話番号の桁数が不正です（10〜13桁）' }
    }
    phone = ph
  }

  return {
    data: {
      name,
      grade,
      affiliation,
      isCircleMember,
      familyName,
      givenName,
      facultyKind,
      faculty,
      schoolYear,
      phone,
      birthDate,
    },
  }
}

export type RegisterViaInviteState = {
  error?: string
}

/**
 * Best-effort JWT refresh + redirect-home, shared by both the member and guest
 * insert paths after a successful row creation. Self-heals via nodeJwtCallback
 * on the next Node render if the refresh itself fails.
 */
async function finishRegistration(now: Date): Promise<never> {
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

/**
 * Complete invite-link self-registration: create the member/guest row and bind
 * it to the current LINE session.
 *
 * `token` is bound via `.bind(null, token)` in the form so this stays a
 * useActionState `(prevState, formData)` action. Flow:
 *   1. Already bound (session.user.id) → nothing to do, go to dashboard.
 *      No LINE session yet → bounce back to the link to (re)start OAuth.
 *   2. Re-validate the token (not revoked, not expired) — the page also checked
 *      at render, but an open tab can cross the expiry, so re-check at submit.
 *      The invite's `kind` (re-read from the token, never from client input —
 *      guest-role requirements §R1) decides which branch runs below.
 *   3a. kind='guest' → validate 表示名/級/所属会 (all required) and INSERT
 *       users(role=guest, isInvited, grade, affiliation, lineUserId,
 *       method=invite_link) with every structured-name/PII column left at its
 *       default (NULL/false) — guests are never asked for PII.
 *   3b. kind='member' → validate the structured name + conditional 段位/全日協
 *       PII and 合成 `name`, then INSERT users(role=member, ...) as before.
 *   4. Either branch: users.name UNIQUE → contact-admin message;
 *      users.line_user_id UNIQUE (double-submit / race — this LINE account
 *      already registered) → just log them in.
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
    columns: { revokedAt: true, expiresAt: true, kind: true },
  })
  if (!invite || !isRegistrationInviteUsable(invite)) {
    return { error: '招待リンクの有効期限が切れています。' }
  }

  const now = new Date()

  if (invite.kind === 'guest') {
    const parsed = parseGuestRegistration(formData)
    if ('error' in parsed) {
      return { error: parsed.error }
    }
    const g = parsed.data
    try {
      await db.insert(users).values({
        name: g.name,
        grade: g.grade,
        affiliation: g.affiliation,
        role: 'guest',
        isInvited: true,
        invitedAt: now,
        lineUserId,
        lineLinkedAt: now,
        lineLinkedMethod: 'invite_link',
        // travel-report R1: サークル所属 ON のときだけ姓・名（漢字）・学部属性・
        // 電話・生年月日を書く（かなは聞かない）。
        isCircleMember: g.isCircleMember,
        familyName: g.familyName,
        givenName: g.givenName,
        facultyKind: g.facultyKind,
        faculty: g.faculty,
        schoolYear: g.schoolYear,
        phone: g.phone,
        birthDate: g.birthDate,
      })
    } catch (err) {
      if (isRedirectError(err)) throw err
      if (isUniqueViolation(err)) {
        const constraint = uniqueViolationConstraint(err) ?? ''
        if (constraint.includes('line_user_id')) {
          redirect('/')
        }
        return { error: '同名の会員が既に存在します。管理者にご連絡ください。' }
      }
      throw err
    }

    return finishRegistration(now)
  }

  const parsed = parseRegistration(formData)
  if ('error' in parsed) {
    return { error: parsed.error }
  }
  const v = parsed.data

  try {
    await db.insert(users).values({
      name: v.name,
      familyName: v.familyName,
      givenName: v.givenName,
      familyKana: v.familyKana,
      givenKana: v.givenKana,
      grade: v.grade,
      dan: v.dan,
      gender: v.gender,
      zenNichikyo: v.zenNichikyo,
      birthDate: v.birthDate,
      phone: v.phone,
      postalCode: v.postalCode,
      address1: v.address1,
      address2: v.address2,
      role: 'member',
      isInvited: true,
      invitedAt: now,
      lineUserId,
      lineLinkedAt: now,
      lineLinkedMethod: 'invite_link',
      // travel-report R1: サークル所属と学部属性。
      isCircleMember: v.isCircleMember,
      facultyKind: v.facultyKind,
      faculty: v.faculty,
      schoolYear: v.schoolYear,
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
      // Otherwise the (composed) name collided (users.name UNIQUE, incl. deactivated).
      return { error: '同名の会員が既に存在します。管理者にご連絡ください。' }
    }
    throw err
  }

  return finishRegistration(now)
}

function isRedirectError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.includes('NEXT_REDIRECT')
}
