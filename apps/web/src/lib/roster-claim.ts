import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db-errors'
import { users } from '@kagetra/shared/schema'
import { parseRosterClaimInput, type RosterCandidate } from './roster-claim-input'

/**
 * roster-claim: `/register/[token]` と `/self-identify` から共通で使う、
 * 「未紐付けの招待済み会員」に LINE アカウントを紐付ける処理。
 */

export const ROSTER_CLAIM_MESSAGES = {
  unavailable:
    '選択された会員は既に別の方に紐付けられているか、招待状態が変わっています。一覧を再確認してください。',
  duplicate:
    'この LINE アカウントは既に別の会員に紐付いています。管理者にご連絡ください。',
  invalidInput: '選択内容が無効です。もう一度お試しください。',
} as const

// 「名簿の候補」条件: LINE 未紐付け ∧ 招待済み ∧ 退会していない。
function candidateCondition() {
  return and(isNull(users.lineUserId), eq(users.isInvited, true), isNull(users.deactivatedAt))
}

// 電話が空かどうか（NULL または空白のみ）。
const needsPhoneExpr: SQL<boolean> = sql<boolean>`(${users.phone} IS NULL OR btrim(${users.phone}) = '')`
// 生年月日が空かどうか。
const needsBirthDateExpr: SQL<boolean> = sql<boolean>`${users.birthDate} IS NULL`

/**
 * 表示用の名簿候補一覧。氏名昇順。`phone`・`birthDate` 自体は select しない
 * — 未紐付け LINE user へ PII を一切開示しないため、真偽値だけを SQL 側で
 * 射影する。
 */
export async function listRosterCandidates(): Promise<RosterCandidate[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      needsPhone: needsPhoneExpr,
      needsBirthDate: needsBirthDateExpr,
    })
    .from(users)
    .where(candidateCondition())
    .orderBy(asc(users.name))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    needsPhone: Boolean(r.needsPhone),
    needsBirthDate: Boolean(r.needsBirthDate),
  }))
}

/**
 * 招待登録の氏名 UNIQUE 違反時に、衝突相手が「名簿の候補」（=まだ LINE 紐付け
 * 待ちの本人かもしれない行）かどうかを判定する。
 */
export async function hasRosterCandidateNamed(name: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.name, name), candidateCondition()))
    .limit(1)
  return rows.length > 0
}

export type RosterClaimMethod = 'invite_link' | 'self_identify'

export type RosterClaimResult =
  | { kind: 'ok'; linkedAt: Date }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable' }
  | { kind: 'duplicate' }

/**
 * 名簿候補への LINE 紐付け + サークル所属ブロックの保存。
 *
 * 対象行を `FOR UPDATE` でロックしてから、そのロック結果（送信されたクライ
 * アント側の印ではなく DB の現在値）を使って `parseRosterClaimInput` を検証
 * する。更新列は明示的に列挙し、フォームやパース結果をスプレッドでそのまま
 * 書き込まない（サークル所属 OFF なら学部属性・電話・生年月日には触れず
 * 既存値を保持する）。
 */
export async function claimRosterMember(args: {
  lineUserId: string
  method: RosterClaimMethod
  formData: FormData
}): Promise<RosterClaimResult> {
  const { lineUserId, method, formData } = args

  const rawUserId = formData.get('userId')
  const userId = typeof rawUserId === 'string' ? rawUserId.trim() : ''
  if (userId.length === 0) {
    return { kind: 'invalid', message: ROSTER_CLAIM_MESSAGES.invalidInput }
  }

  try {
    return await db.transaction(async (tx): Promise<RosterClaimResult> => {
      const locked = await tx
        .select({
          id: users.id,
          needsPhone: needsPhoneExpr,
          needsBirthDate: needsBirthDateExpr,
        })
        .from(users)
        .where(and(eq(users.id, userId), candidateCondition()))
        .for('update')

      const target = locked[0]
      if (!target) {
        return { kind: 'unavailable' }
      }

      const parsed = parseRosterClaimInput(formData, {
        needsPhone: Boolean(target.needsPhone),
        needsBirthDate: Boolean(target.needsBirthDate),
      })
      if ('error' in parsed) {
        return { kind: 'invalid', message: parsed.error }
      }
      const v = parsed.data

      const now = new Date()
      const update: Partial<typeof users.$inferInsert> = {
        lineUserId,
        lineLinkedAt: now,
        lineLinkedMethod: method,
        updatedAt: now,
        isCircleMember: v.isCircleMember,
      }
      if (v.isCircleMember) {
        update.facultyKind = v.facultyKind
        update.faculty = v.faculty
        update.schoolYear = v.schoolYear
        if (v.phone !== null) update.phone = v.phone
        if (v.birthDate !== null) update.birthDate = v.birthDate
      }

      const updated = await tx
        .update(users)
        .set(update)
        .where(and(eq(users.id, userId), candidateCondition()))
        .returning({ id: users.id })

      if (updated.length === 0) {
        return { kind: 'unavailable' }
      }

      return { kind: 'ok', linkedAt: now }
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { kind: 'duplicate' }
    }
    throw err
  }
}
