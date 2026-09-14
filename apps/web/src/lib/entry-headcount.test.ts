import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { loadGroupHeadcountFacts } from './entry-headcount'

async function attend(eventId: number, userId: string, value = true) {
  await createEventAttendance({ eventId, userId, attend: value })
}

/** id 昇順を決定的に検証するため、id と LINE 紐付けを明示して作る。 */
function linked(id: string) {
  return { id, lineUserId: `U-${id}`, lineLinkedAt: new Date() }
}

// ★プールを閉じるのはファイル単位で1回だけ。describe ごとに afterAll で閉じると、
// 先に終わった describe が後続の describe のためのプールまで落としてしまう。
afterAll(async () => {
  await closeTestDb()
})

describe('loadGroupHeadcountFacts', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('ゲストは人数に数えず、フラグだけを立てる（AC-H3）', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const member = await createUser({ name: 'f-member' })
    const guest = await createGuest({ name: 'f-guest' })
    await attend(day.id, member.id)
    await attend(day.id, guest.id)

    const facts = await loadGroupHeadcountFacts(testDb, group.id)
    expect([...facts.entrantUserIds]).toEqual([member.id])
    expect(facts.hasGuestEntrant).toBe(true)
  })

  it('ゲストが居なければ hasGuestEntrant は false', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const member = await createUser({ name: 'f-only-member' })
    await attend(day.id, member.id)

    const facts = await loadGroupHeadcountFacts(testDb, group.id)
    expect(facts.hasGuestEntrant).toBe(false)
    expect(facts.hasCircleMemberEntrant).toBe(false)
  })

  it('サークル所属 ON の参加会員がいれば hasCircleMemberEntrant が立つ（AC-H12/14 の材料）', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const circle = await createUser({ name: 'f-circle', isCircleMember: true })
    await attend(day.id, circle.id)

    expect((await loadGroupHeadcountFacts(testDb, group.id)).hasCircleMemberEntrant).toBe(true)
  })

  it('サークル所属 ON でも参加していなければフラグは立たない', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const circle = await createUser({ name: 'f-circle-absent', isCircleMember: true })
    await attend(day.id, circle.id, false)

    expect((await loadGroupHeadcountFacts(testDb, group.id)).hasCircleMemberEntrant).toBe(false)
  })

  it('複数日に出る同じ会員を1人として数える（AC-H21）', async () => {
    const group = await createEntryGroup()
    const day1 = await createEvent({ entryGroupId: group.id, eventDate: '2026-08-01' })
    const day2 = await createEvent({ entryGroupId: group.id, eventDate: '2026-08-08' })
    const user = await createUser({ name: 'f-both-days' })
    await attend(day1.id, user.id)
    await attend(day2.id, user.id)

    expect((await loadGroupHeadcountFacts(testDb, group.id)).entrantUserIds.size).toBe(1)
  })

  it('中止した日は数えない（AC-H19）', async () => {
    const group = await createEntryGroup()
    const cancelled = await createEvent({ entryGroupId: group.id, status: 'cancelled' })
    const user = await createUser({ name: 'f-cancelled', isCircleMember: true })
    const guest = await createGuest({ name: 'f-cancelled-guest' })
    await attend(cancelled.id, user.id)
    await attend(cancelled.id, guest.id)

    const facts = await loadGroupHeadcountFacts(testDb, group.id)
    expect(facts.entrantUserIds.size).toBe(0)
    expect(facts.hasGuestEntrant).toBe(false)
    expect(facts.hasCircleMemberEntrant).toBe(false)
  })

  it('対象級外の会員は数えない（eligible_grades フィルタ・AC-H20）', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id, eligibleGrades: ['A'] })
    const a = await createUser({ name: 'f-a', grade: 'A' })
    const c = await createUser({ name: 'f-c', grade: 'C' })
    await attend(day.id, a.id)
    await attend(day.id, c.id)

    expect([...(await loadGroupHeadcountFacts(testDb, group.id)).entrantUserIds]).toEqual([a.id])
  })

  it('不参加・未回答は数えない', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const yes = await createUser({ name: 'f-yes' })
    const no = await createUser({ name: 'f-no' })
    await createUser({ name: 'f-silent' })
    await attend(day.id, yes.id)
    await attend(day.id, no.id, false)

    expect([...(await loadGroupHeadcountFacts(testDb, group.id)).entrantUserIds]).toEqual([yes.id])
  })

  it('役割保持者を3種に仕分け、id 昇順・名字で返す（AC-H5, AC-H7, AC-H8）', async () => {
    const group = await createEntryGroup()
    await createAdmin({ ...linked('id-b'), name: 'r-admin', familyName: '酒井' })
    await createUser({ ...linked('id-a'), name: 'r-treasurer', familyName: '飯塚', isTreasurer: true })
    await createUser({
      ...linked('id-c'),
      name: 'r-submitter',
      familyName: '土居',
      isTravelReportSubmitter: true,
    })

    const facts = await loadGroupHeadcountFacts(testDb, group.id)
    expect(facts.admins).toEqual([{ userId: 'id-b', displayName: '酒井' }])
    expect(facts.treasurers).toEqual([{ userId: 'id-a', displayName: '飯塚' }])
    expect(facts.travelReportSubmitters).toEqual([{ userId: 'id-c', displayName: '土居' }])
  })

  it('同じ人が複数の役割を兼ねていれば、その全ての行に現れる（排他は pure 層の仕事）', async () => {
    const group = await createEntryGroup()
    await createAdmin({
      ...linked('id-1'),
      name: 'r-multi',
      familyName: '兼務',
      isTreasurer: true,
      isTravelReportSubmitter: true,
    })

    const facts = await loadGroupHeadcountFacts(testDb, group.id)
    const holder = { userId: 'id-1', displayName: '兼務' }
    expect(facts.admins).toEqual([holder])
    expect(facts.treasurers).toEqual([holder])
    expect(facts.travelReportSubmitters).toEqual([holder])
  })

  it('複数該当は users.id 昇順で並ぶ（AC-H8）', async () => {
    const group = await createEntryGroup()
    await createAdmin({ ...linked('id-z'), name: 'r-z', familyName: '酒井' })
    await createAdmin({ ...linked('id-a'), name: 'r-a', familyName: '飯塚' })

    expect(
      (await loadGroupHeadcountFacts(testDb, group.id)).admins.map((a) => a.displayName),
    ).toEqual(['飯塚', '酒井'])
  })

  it('vice_admin は管理者の行に入らない（AC-H16 と同じ母集団）', async () => {
    const group = await createEntryGroup()
    await createViceAdmin({ ...linked('id-1'), name: 'r-vice', familyName: '副' })

    expect((await loadGroupHeadcountFacts(testDb, group.id)).admins).toEqual([])
  })

  it('LINE 未紐付け・無効化された役割保持者は外れる（AC-H6）', async () => {
    const group = await createEntryGroup()
    await createAdmin({ id: 'id-1', name: 'r-nolink', familyName: '未紐付', lineUserId: null })
    await createAdmin({
      ...linked('id-2'),
      name: 'r-dead',
      familyName: '退会',
      deactivatedAt: new Date(),
    })
    await createAdmin({ ...linked('id-3'), name: 'r-ok', familyName: '在籍' })

    expect((await loadGroupHeadcountFacts(testDb, group.id)).admins).toEqual([
      { userId: 'id-3', displayName: '在籍' },
    ])
  })

  it('family_name が NULL なら name を出す（AC-H7）', async () => {
    const group = await createEntryGroup()
    await createAdmin({ ...linked('id-1'), name: '山田 太郎', familyName: null })

    expect((await loadGroupHeadcountFacts(testDb, group.id)).admins).toEqual([
      { userId: 'id-1', displayName: '山田 太郎' },
    ])
  })
})
