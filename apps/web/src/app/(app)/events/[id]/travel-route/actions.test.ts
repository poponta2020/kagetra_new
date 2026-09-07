import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { entryGroupTravelSettings, travelRoutes, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * travel-report S8 (actions.ts): 経路保存 Server Action。ページ側の判定を
 * 一切信頼せず独立に再検証する（fail-closed）ことを、ページを経由せず
 * FormData 直叩きで確認する。
 */

const { sendAllEnteredNoticeMock } = vi.hoisted(() => ({
  sendAllEnteredNoticeMock: vi.fn(async () => ({ outcome: 'sent' as const })),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/travel-report/notify', () => ({
  sendAllEnteredNotice: sendAllEnteredNoticeMock,
}))

// Import under test AFTER mocks so @/auth / notify resolution uses the mocks.
const { saveTravelRouteAction } = await import('./actions')

afterAll(async () => {
  await closeTestDb()
})

const UNIT_START = '2026-10-10'
const UNIT_END = '2026-10-11'

async function setupOpenUnit() {
  const group = await createEntryGroup()
  const day1 = await createEvent({ entryGroupId: group.id, eventDate: UNIT_START, title: '十和田大会 A・B級' })
  const day2 = await createEvent({ entryGroupId: group.id, eventDate: UNIT_END, title: '十和田大会 C・D・E級' })
  await testDb.insert(entryGroupTravelSettings).values({
    entryGroupId: group.id,
    routeInputStartedAt: new Date(),
  })
  return { group, day1, day2 }
}

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function baseFields(opts: { eventId: number; entryGroupId: number; targetUserId: string }) {
  return {
    eventId: String(opts.eventId),
    entryGroupId: String(opts.entryGroupId),
    targetUserId: opts.targetUserId,
    departureKind: 'sapporo',
    departurePlace: '',
    returnKind: 'sapporo',
    returnPlace: '',
    legs: JSON.stringify([{ date: '2026-10-09', from: '札幌', to: '十和田' }]),
  }
}

describe('saveTravelRouteAction', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('本人が自分の経路を保存できる', async () => {
    const { group, day1 } = await setupOpenUnit()
    const member = await createUser({ isCircleMember: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await saveTravelRouteAction(
      {},
      formOf(baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })),
    )
    expect(result).toEqual({ success: true })

    const saved = await testDb.query.travelRoutes.findFirst({
      where: eq(travelRoutes.userId, member.id),
    })
    expect(saved?.legs).toEqual([{ date: '2026-10-09', from: '札幌', to: '十和田' }])
    expect(saved?.savedByUserId).toBe(member.id)
  })

  it('提出権限者は他人の経路を代理保存できる', async () => {
    const { group, day1 } = await setupOpenUnit()
    const member = await createUser({ isCircleMember: true })
    const submitter = await createUser({ isCircleMember: true, isTravelReportSubmitter: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: submitter.id, role: 'member' })

    const result = await saveTravelRouteAction(
      {},
      formOf(baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })),
    )
    expect(result).toEqual({ success: true })

    const saved = await testDb.query.travelRoutes.findFirst({
      where: eq(travelRoutes.userId, member.id),
    })
    expect(saved?.userId).toBe(member.id)
    expect(saved?.savedByUserId).toBe(submitter.id)
  })

  it('AC-15: 一般会員が他人の経路を保存しようとすると拒否される', async () => {
    const { group, day1 } = await setupOpenUnit()
    const member = await createUser({ isCircleMember: true })
    const other = await createUser({ isCircleMember: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: other.id, role: 'member' })

    const result = await saveTravelRouteAction(
      {},
      formOf(baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })),
    )
    expect(result.error).toBe('他の人の経路を保存する権限がありません')

    const saved = await testDb.query.travelRoutes.findFirst({
      where: eq(travelRoutes.userId, member.id),
    })
    expect(saved).toBeUndefined()
  })

  it('AC-11: 経路入力が開始されていないグループでは拒否される', async () => {
    const group = await createEntryGroup()
    const day1 = await createEvent({ entryGroupId: group.id, eventDate: UNIT_START })
    // entry_group_travel_settings の行を作らない = 既定（未開始・確定名簿なし）。
    const member = await createUser({ isCircleMember: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await saveTravelRouteAction(
      {},
      formOf(baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })),
    )
    expect(result.error).toBe('経路入力はまだ開始されていません')
  })

  it('AC-14: 行きが「その他」で地名が空なら保存を拒否する', async () => {
    const { group, day1 } = await setupOpenUnit()
    const member = await createUser({ isCircleMember: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: member.id, role: 'member' })

    const fields = baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })
    const result = await saveTravelRouteAction(
      {},
      formOf({ ...fields, departureKind: 'other', departurePlace: '' }),
    )
    expect(result.error).toBe('行きの地名を入力してください')
  })

  it('プロフィールの書き戻しは対象者に対して行われる（代理入力でも）', async () => {
    const { group, day1 } = await setupOpenUnit()
    const member = await createUser({ isCircleMember: true, faculty: null, schoolYear: null, phone: null })
    const submitter = await createUser({ isCircleMember: true, isTravelReportSubmitter: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: submitter.id, role: 'member' })

    const fields = baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })
    const result = await saveTravelRouteAction(
      {},
      formOf({
        ...fields,
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '2年',
        phone: '090-0000-0001',
      }),
    )
    expect(result).toEqual({ success: true })

    const [updatedMember] = await testDb.select().from(users).where(eq(users.id, member.id))
    expect(updatedMember?.faculty).toBe('法学部')
    expect(updatedMember?.schoolYear).toBe('2年')
    expect(updatedMember?.phone).toBe('090-0000-0001')

    const [updatedSubmitter] = await testDb.select().from(users).where(eq(users.id, submitter.id))
    expect(updatedSubmitter?.faculty).toBeNull()
  })

  it('shouldNotify が true のとき sendAllEnteredNotice が呼ばれる', async () => {
    const { group, day1 } = await setupOpenUnit()
    const member = await createUser({ isCircleMember: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await setAuthSession({ id: member.id, role: 'member' })
    sendAllEnteredNoticeMock.mockClear()

    const result = await saveTravelRouteAction(
      {},
      formOf(baseFields({ eventId: day1.id, entryGroupId: group.id, targetUserId: member.id })),
    )
    expect(result).toEqual({ success: true })
    expect(sendAllEnteredNoticeMock).toHaveBeenCalledTimes(1)
    expect(sendAllEnteredNoticeMock).toHaveBeenCalledWith(
      expect.objectContaining({ entryGroupId: group.id, unitStartDate: UNIT_START, memberCount: 1 }),
    )
  })
})
