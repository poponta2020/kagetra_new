import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  membershipRenewalMembers,
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser } from '@/test-utils/seed'
import { completeRenewal, saveRenewalAnswer, startRenewal } from './store'
import { applySchoolYearForToday, previewSchoolYearApply } from './apply-school-year'

/**
 * apply-school-year: 00:05 バッチ本体のテスト（annual-registration-renewal
 * タスク8・R4・AC-12）。
 *
 * ★対象者は必ず `startOpenRenewal` を呼ぶ**前**に `createUser` すること
 * （AC-1: 対象集合は開始時点で確定する）。
 */

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

afterAll(async () => {
  await closeTestDb()
  if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
})

beforeEach(async () => {
  await truncateAll()
  process.env.PUBLIC_BASE_URL = 'https://example.test'
})

async function seedClubLineGroup() {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 's',
      channelAccessToken: 't',
      botId: '@club-bot',
      purpose: 'club_chat',
      status: 'assigned',
    })
    .returning({ id: lineChannels.id })
  await testDb.insert(clubLineGroups).values({
    lineChannelId: channel!.id,
    oamAccountPath: 'U16c4a1b2c3d4e5f60718293a4b5c6d70',
    oamChatRoomId: 'C432c0102030405060708090a0b0c0d0e',
    chatRoomName: '会グループ',
  })
}

async function startOpenRenewal(opts: { fiscalYear?: number; deadline?: string } = {}) {
  const admin = await createAdmin({ name: 'admin' })
  const result = await startRenewal(
    { fiscalYear: opts.fiscalYear ?? 2027, deadline: opts.deadline ?? '2027-03-25', note: null },
    admin.id,
    new Date('2027-03-10T03:00:00Z'),
  )
  return (result as { renewalId: number }).renewalId
}

async function loadMember(userId: string) {
  const [row] = await testDb
    .select()
    .from(membershipRenewalMembers)
    .where(eq(membershipRenewalMembers.userId, userId))
  return row!
}

async function loadUser(userId: string) {
  const [row] = await testDb.select().from(users).where(eq(users.id, userId))
  return row!
}

describe('applySchoolYearForToday', () => {
  it('4/1 より前は反映せず applied_at を NULL のまま残す', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '3年' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    const result = await applySchoolYearForToday({ now: new Date('2027-03-20T03:00:00Z') })
    expect(result).toEqual({ checked: 1, applied: 0 })

    expect((await loadMember(student.id)).schoolYearAppliedAt).toBeNull()
    expect((await loadUser(student.id)).schoolYear).toBe('2年')
  })

  it('3/31 は反映されず、4/1 になったら反映される（境界値・AC-12）', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '3年' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    // 2027-03-31 19:00 JST（=10:00 UTC）はまだ 3/31。
    const beforeResult = await applySchoolYearForToday({ now: new Date('2027-03-31T10:00:00Z') })
    expect(beforeResult.applied).toBe(0)
    expect((await loadUser(student.id)).schoolYear).toBe('2年')

    // 2027-04-01 09:01 JST（=00:01 UTC）は 4/1。
    const afterResult = await applySchoolYearForToday({ now: new Date('2027-04-01T00:01:00Z') })
    expect(afterResult.applied).toBe(1)
    expect((await loadUser(student.id)).schoolYear).toBe('3年')
  })

  it('4/1 以降は進学の回答（絶対値）を反映し applied_at をセットする', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '4年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: {
          schoolYearKind: 'advance',
          nextFacultyKind: 'graduate',
          nextFaculty: '文学研究科',
          nextSchoolYear: '修士1年',
        },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    const result = await applySchoolYearForToday({ now: new Date('2027-04-01T00:10:00Z') })
    expect(result).toEqual({ checked: 1, applied: 1 })

    const after = await loadUser(student.id)
    expect(after.facultyKind).toBe('graduate')
    expect(after.faculty).toBe('文学研究科')
    expect(after.schoolYear).toBe('修士1年')
    expect((await loadMember(student.id)).schoolYearAppliedAt).not.toBeNull()
  })

  it('卒業（leave）は is_circle_member を false にし、学部等名・学年は残す', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '卒業生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '4年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'leave' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    const result = await applySchoolYearForToday({ now: new Date('2027-04-01T00:10:00Z') })
    expect(result.applied).toBe(1)

    const after = await loadUser(student.id)
    expect(after.isCircleMember).toBe(false)
    expect(after.faculty).toBe('文学部')
    expect(after.schoolYear).toBe('4年')
  })

  it('二重実行しても再反映しない（CAS）', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '3年' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    const now = new Date('2027-04-01T00:10:00Z')
    const first = await applySchoolYearForToday({ now })
    expect(first.applied).toBe(1)

    const second = await applySchoolYearForToday({ now })
    expect(second).toEqual({ checked: 0, applied: 0 })
    expect((await loadUser(student.id)).schoolYear).toBe('3年')
  })

  it('学年未回答の対象者は候補にならない', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答学生', isCircleMember: true })
    await startOpenRenewal({ fiscalYear: 2027 })

    const result = await applySchoolYearForToday({ now: new Date('2027-04-01T00:10:00Z') })
    expect(result).toEqual({ checked: 0, applied: 0 })
  })

  it('登録完了（completed）後でも反映する（renewal の status は見ない）', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '3年' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )
    const admin = await createAdmin({ name: 'admin2' })
    await completeRenewal(renewalId, admin.id, new Date('2027-03-26T03:00:00Z'))

    const result = await applySchoolYearForToday({ now: new Date('2027-04-01T00:10:00Z') })
    expect(result.applied).toBe(1)
    expect((await loadUser(student.id)).schoolYear).toBe('3年')
  })
})

describe('previewSchoolYearApply（--dry-run）', () => {
  it('4/1 以降なら反映される見込みのパッチを返し、users は書き換えない', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '3年' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    const preview = await previewSchoolYearApply({ now: new Date('2027-04-01T00:10:00Z') })
    expect(preview).toEqual([
      { userId: student.id, fiscalYear: 2027, patch: { schoolYear: '3年' } },
    ])
    expect((await loadUser(student.id)).schoolYear).toBe('2年')
    expect((await loadMember(student.id)).schoolYearAppliedAt).toBeNull()
  })

  it('4/1 より前は空配列（反映見込みなし）', async () => {
    await seedClubLineGroup()
    const student = await createUser({
      name: '学生',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const renewalId = await startOpenRenewal({ fiscalYear: 2027 })
    await saveRenewalAnswer(
      {
        renewalId,
        userId: student.id,
        actorUserId: student.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '3年' },
      },
      new Date('2027-03-15T03:00:00Z'),
    )

    const preview = await previewSchoolYearApply({ now: new Date('2027-03-20T03:00:00Z') })
    expect(preview).toEqual([])
  })
})
