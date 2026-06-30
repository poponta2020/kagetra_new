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
 *   - zenNichikyo = false → all PII (gender/birth/phone/postal/address) = null
 * PII is all-required when zenNichikyo is on, except address2 (DB-nullable; the
 * front enforces it via the 戸建て checkbox). Messages are field-specific.
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

  let gender: (typeof GENDERS)[number] | null = null
  let birthDate: string | null = null
  let phone: string | null = null
  let postalCode: string | null = null
  let address1: string | null = null
  let address2: string | null = null

  if (zenNichikyo) {
    const g = strOf(formData.get('gender')).trim()
    if (g !== 'male' && g !== 'female') return { error: '性別を選択してください' }
    gender = g

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
    },
  }
}

export type RegisterViaInviteState = {
  error?: string
}

/**
 * Complete invite-link self-registration: create the member row and bind it to
 * the current LINE session.
 *
 * `token` is bound via `.bind(null, token)` in the form so this stays a
 * useActionState `(prevState, formData)` action. Flow:
 *   1. Already bound (session.user.id) → nothing to do, go to dashboard.
 *      No LINE session yet → bounce back to the link to (re)start OAuth.
 *   2. Re-validate the token (not revoked, not expired) — the page also checked
 *      at render, but an open tab can cross the expiry, so re-check at submit.
 *   3. Validate the structured name + conditional 段位/全日協 PII and 合成 `name`.
 *   4. INSERT users(role=member, isInvited, lineUserId, method=invite_link) plus
 *      the structured-name + PII columns. users.name UNIQUE → contact-admin
 *      message; users.line_user_id UNIQUE (double-submit / race — this LINE
 *      account already registered) → just log them in.
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
    columns: { revokedAt: true, expiresAt: true },
  })
  if (!isRegistrationInviteUsable(invite)) {
    return { error: '招待リンクの有効期限が切れています。' }
  }

  const parsed = parseRegistration(formData)
  if ('error' in parsed) {
    return { error: parsed.error }
  }
  const v = parsed.data

  const now = new Date()
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

function isRedirectError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.includes('NEXT_REDIRECT')
}
