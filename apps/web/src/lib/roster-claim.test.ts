import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import {
  claimRosterMember,
  hasRosterCandidateNamed,
  listRosterCandidates,
  ROSTER_CLAIM_MESSAGES,
} from './roster-claim'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.set(k, v)
  return fd
}

type UserRow = typeof users.$inferSelect

async function fetchUser(id: string): Promise<UserRow> {
  const [row] = await testDb.select().from(users).where(eq(users.id, id))
  if (!row) throw new Error('user not found')
  return row
}

// Columns whose values differ between `before` and `after`, comparing Date
// fields by epoch millis. Used to assert the update touched exactly the
// expected set of columns (AC-4 whitelist).
function changedColumns(before: UserRow, after: UserRow): string[] {
  const beforeRec = before as unknown as Record<string, unknown>
  const afterRec = after as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(beforeRec), ...Object.keys(afterRec)])
  const changed: string[] = []
  for (const k of keys) {
    const b = beforeRec[k]
    const a = afterRec[k]
    const bVal = b instanceof Date ? b.getTime() : b
    const aVal = a instanceof Date ? a.getTime() : a
    if (bVal !== aVal) changed.push(k)
  }
  return changed.sort()
}

// A fully-populated candidate row so a "no unexpected columns changed" check
// is meaningful — every writable column starts non-default/non-null.
async function createFullCandidate(overrides: Partial<Parameters<typeof createUser>[0]> = {}) {
  const uid = crypto.randomUUID()
  return createUser({
    name: `roster-full-${uid}`,
    email: `roster-full-${uid}@example.com`,
    familyName: '佐藤',
    givenName: '花子',
    familyKana: 'さとう',
    givenKana: 'はなこ',
    grade: 'B',
    gender: 'male',
    zenNichikyo: true,
    birthDate: '1990-04-01',
    phone: '090-1111-2222',
    postalCode: '0010010',
    address1: '札幌市北区北十条西1-1',
    address2: '北棟101',
    affiliation: '北海道大学かるた会',
    role: 'member',
    isTreasurer: false,
    isInvited: true,
    lineUserId: null,
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...overrides,
  })
}

describe('listRosterCandidates', () => {
  it('excludes non-invited, deactivated, and already-linked users', async () => {
    const candidate = await createUser({ name: 'B候補', isInvited: true, lineUserId: null })
    await createUser({ name: 'A未招待', isInvited: false, lineUserId: null })
    await createUser({
      name: 'C退会済',
      isInvited: true,
      lineUserId: null,
      deactivatedAt: new Date(),
    })
    await createUser({ name: 'D紐付け済', isInvited: true, lineUserId: 'Ulinked' })

    const result = await listRosterCandidates()
    expect(result.map((r) => r.id)).toEqual([candidate.id])
  })

  it('orders by name ascending', async () => {
    await createUser({ name: 'beta', isInvited: true, lineUserId: null })
    await createUser({ name: 'alpha', isInvited: true, lineUserId: null })
    await createUser({ name: 'gamma', isInvited: true, lineUserId: null })

    const result = await listRosterCandidates()
    expect(result.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('each element exposes exactly id/name/needsPhone/needsBirthDate', async () => {
    await createUser({ name: 'shape-check', isInvited: true, lineUserId: null })
    const result = await listRosterCandidates()
    expect(result).toHaveLength(1)
    expect(Object.keys(result[0]!).sort()).toEqual(
      ['id', 'name', 'needsBirthDate', 'needsPhone'].sort(),
    )
  })

  it('needsPhone is true for null phone, true for blank phone, false otherwise', async () => {
    const nullPhone = await createUser({
      name: 'phone-null',
      isInvited: true,
      lineUserId: null,
      phone: null,
    })
    const blankPhone = await createUser({
      name: 'phone-blank',
      isInvited: true,
      lineUserId: null,
      phone: '   ',
    })
    const withPhone = await createUser({
      name: 'phone-set',
      isInvited: true,
      lineUserId: null,
      phone: '090-1234-5678',
    })

    const result = await listRosterCandidates()
    const byId = new Map(result.map((r) => [r.id, r]))
    expect(byId.get(nullPhone.id)?.needsPhone).toBe(true)
    expect(byId.get(blankPhone.id)?.needsPhone).toBe(true)
    expect(byId.get(withPhone.id)?.needsPhone).toBe(false)
  })

  it('needsBirthDate is true for null birthDate, false otherwise', async () => {
    const nullBirth = await createUser({
      name: 'birth-null',
      isInvited: true,
      lineUserId: null,
      birthDate: null,
    })
    const withBirth = await createUser({
      name: 'birth-set',
      isInvited: true,
      lineUserId: null,
      birthDate: '1990-04-01',
    })

    const result = await listRosterCandidates()
    const byId = new Map(result.map((r) => [r.id, r]))
    expect(byId.get(nullBirth.id)?.needsBirthDate).toBe(true)
    expect(byId.get(withBirth.id)?.needsBirthDate).toBe(false)
  })
})

describe('hasRosterCandidateNamed', () => {
  it('returns true for a candidate name', async () => {
    await createUser({ name: '候補太郎', isInvited: true, lineUserId: null })
    expect(await hasRosterCandidateNamed('候補太郎')).toBe(true)
  })

  it('returns false for an already-linked user with that name', async () => {
    await createUser({ name: '紐付済太郎', isInvited: true, lineUserId: 'Ulinked' })
    expect(await hasRosterCandidateNamed('紐付済太郎')).toBe(false)
  })

  it('returns false for a deactivated user with that name', async () => {
    await createUser({
      name: '退会太郎',
      isInvited: true,
      lineUserId: null,
      deactivatedAt: new Date(),
    })
    expect(await hasRosterCandidateNamed('退会太郎')).toBe(false)
  })

  it('returns false for a non-invited user with that name', async () => {
    await createUser({ name: '未招待太郎', isInvited: false, lineUserId: null })
    expect(await hasRosterCandidateNamed('未招待太郎')).toBe(false)
  })

  it('returns false when no such name exists', async () => {
    expect(await hasRosterCandidateNamed('存在しない太郎')).toBe(false)
  })
})

describe('claimRosterMember', () => {
  it('AC-4: only the expected columns change, ignoring hostile extra fields (fully-populated candidate)', async () => {
    const candidate = await createFullCandidate()
    const before = await fetchUser(candidate.id)

    const formData = formOf({
      userId: candidate.id,
      isCircleMember: 'on',
      facultyKind: 'undergraduate',
      faculty: '法学部',
      schoolYear: '1年',
      phone: '080-9999-9999',
      birthDate: '2000-01-01',
      // Hostile extras that must be ignored.
      role: 'admin',
      name: '別人 太郎',
      grade: 'A',
      zenNichikyo: 'on',
      postalCode: '9999999',
      address1: '偽住所',
      isTreasurer: 'on',
      lineLinkedMethod: 'admin_link',
      email: 'evil@example.com',
      deactivatedAt: '2020-01-01',
    })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-1',
      method: 'invite_link',
      formData,
    })
    expect(result.kind).toBe('ok')

    const after = await fetchUser(candidate.id)
    expect(changedColumns(before, after)).toEqual(
      [
        'facultyKind',
        'faculty',
        'isCircleMember',
        'lineLinkedAt',
        'lineLinkedMethod',
        'lineUserId',
        'schoolYear',
        'updatedAt',
      ].sort(),
    )
    expect(after.lineUserId).toBe('Uclaim-1')
    expect(after.lineLinkedMethod).toBe('invite_link')
    // Values that were already present on the candidate stay untouched.
    expect(after.phone).toBe(before.phone)
    expect(after.birthDate).toBe(before.birthDate)
    // Hostile extras had no effect.
    expect(after.role).toBe('member')
    expect(after.name).toBe(before.name)
    expect(after.grade).toBe('B')
  })

  it('AC-4: phone/birthDate are included in the change set when the candidate needed them', async () => {
    const candidate = await createFullCandidate({ phone: null, birthDate: null })
    const before = await fetchUser(candidate.id)

    const formData = formOf({
      userId: candidate.id,
      isCircleMember: 'on',
      facultyKind: 'undergraduate',
      faculty: '法学部',
      schoolYear: '1年',
      phone: '080-9999-9999',
      birthDate: '2000-01-01',
    })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-2',
      method: 'invite_link',
      formData,
    })
    expect(result.kind).toBe('ok')

    const after = await fetchUser(candidate.id)
    expect(changedColumns(before, after)).toEqual(
      [
        'birthDate',
        'facultyKind',
        'faculty',
        'isCircleMember',
        'lineLinkedAt',
        'lineLinkedMethod',
        'lineUserId',
        'phone',
        'schoolYear',
        'updatedAt',
      ].sort(),
    )
    expect(after.phone).toBe('080-9999-9999')
    expect(after.birthDate).toBe('2000-01-01')
  })

  it('records method self_identify on the row', async () => {
    const candidate = await createFullCandidate()
    const formData = formOf({
      userId: candidate.id,
      isCircleMember: 'on',
      facultyKind: 'undergraduate',
      faculty: '法学部',
      schoolYear: '1年',
    })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-3',
      method: 'self_identify',
      formData,
    })
    expect(result.kind).toBe('ok')
    const after = await fetchUser(candidate.id)
    expect(after.lineLinkedMethod).toBe('self_identify')
  })

  it('サークル所属 OFF: existing faculty attributes are preserved and phone/birthDate untouched', async () => {
    const candidate = await createFullCandidate({
      facultyKind: 'graduate',
      faculty: '情報科学院',
      schoolYear: '修士1年',
      phone: null,
      birthDate: null,
    })
    const before = await fetchUser(candidate.id)

    const formData = formOf({
      userId: candidate.id,
      // isCircleMember omitted (OFF)
      facultyKind: 'undergraduate',
      faculty: '法学部',
      schoolYear: '1年',
    })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-4',
      method: 'invite_link',
      formData,
    })
    expect(result.kind).toBe('ok')

    const after = await fetchUser(candidate.id)
    expect(after.isCircleMember).toBe(false)
    expect(after.facultyKind).toBe('graduate')
    expect(after.faculty).toBe('情報科学院')
    expect(after.schoolYear).toBe('修士1年')
    expect(after.phone).toBeNull()
    expect(after.birthDate).toBeNull()
    expect(before.phone).toBeNull()
    expect(before.birthDate).toBeNull()
  })

  it('validation error: faculty missing leaves the row untouched', async () => {
    const candidate = await createFullCandidate()
    const before = await fetchUser(candidate.id)

    const formData = formOf({
      userId: candidate.id,
      isCircleMember: 'on',
      facultyKind: 'undergraduate',
      schoolYear: '1年',
    })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-5',
      method: 'invite_link',
      formData,
    })
    expect(result).toEqual({ kind: 'invalid', message: '学部等名を入力してください' })

    const after = await fetchUser(candidate.id)
    expect(after.lineUserId).toBeNull()
    expect(changedColumns(before, after)).toEqual([])
  })

  it('validation error: candidate needing phone but none supplied leaves the row untouched', async () => {
    const candidate = await createFullCandidate({ phone: null })
    const before = await fetchUser(candidate.id)

    const formData = formOf({
      userId: candidate.id,
      isCircleMember: 'on',
      facultyKind: 'undergraduate',
      faculty: '法学部',
      schoolYear: '1年',
    })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-6',
      method: 'invite_link',
      formData,
    })
    expect(result).toEqual({
      kind: 'invalid',
      message: '電話番号は数字とハイフンで入力してください',
    })

    const after = await fetchUser(candidate.id)
    expect(changedColumns(before, after)).toEqual([])
  })

  it('unavailable: row already linked to another LINE user', async () => {
    const other = await createFullCandidate({ lineUserId: 'Uother' })
    const before = await fetchUser(other.id)

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-7',
      method: 'invite_link',
      formData: formOf({ userId: other.id }),
    })
    expect(result).toEqual({ kind: 'unavailable' })

    const after = await fetchUser(other.id)
    expect(changedColumns(before, after)).toEqual([])
  })

  it('unavailable: deactivated candidate', async () => {
    const candidate = await createFullCandidate({ deactivatedAt: new Date() })
    const before = await fetchUser(candidate.id)

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-8',
      method: 'invite_link',
      formData: formOf({ userId: candidate.id }),
    })
    expect(result).toEqual({ kind: 'unavailable' })

    const after = await fetchUser(candidate.id)
    expect(changedColumns(before, after)).toEqual([])
  })

  it('unavailable: non-invited candidate', async () => {
    const candidate = await createFullCandidate({ isInvited: false })

    const result = await claimRosterMember({
      lineUserId: 'Uclaim-9',
      method: 'invite_link',
      formData: formOf({ userId: candidate.id }),
    })
    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('unavailable: non-existent id', async () => {
    const result = await claimRosterMember({
      lineUserId: 'Uclaim-10',
      method: 'invite_link',
      formData: formOf({ userId: 'no-such-id' }),
    })
    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('duplicate: lineUserId already used by another row', async () => {
    await createFullCandidate({ name: 'dup-owner', lineUserId: 'Udup' })
    const target = await createFullCandidate({ name: 'dup-target' })
    const before = await fetchUser(target.id)

    const result = await claimRosterMember({
      lineUserId: 'Udup',
      method: 'invite_link',
      formData: formOf({ userId: target.id }),
    })
    expect(result).toEqual({ kind: 'duplicate' })

    const after = await fetchUser(target.id)
    expect(changedColumns(before, after)).toEqual([])
  })

  it('invalid: missing userId', async () => {
    const result = await claimRosterMember({
      lineUserId: 'Uclaim-11',
      method: 'invite_link',
      formData: formOf({}),
    })
    expect(result).toEqual({ kind: 'invalid', message: ROSTER_CLAIM_MESSAGES.invalidInput })
  })
})
