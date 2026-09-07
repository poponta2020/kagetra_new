import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { travelRoutes, travelUnitNotices, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createUser } from '@/test-utils/seed'
import { buildTravelUnits } from './units'
import { loadTravelRoute, loadUnitNotices, saveTravelRoute } from './routes-store'
import type { TravelTarget } from './targets'

/**
 * travel-report R8・AC-18: 「全員そろった」の遷移判定と claim。
 * 送信そのもの（LINE push）は `notify.ts` の担当で、ここは **tx の中で何を決めるか**だけを見る。
 */

// ★`afterAll` はトップレベルに1つだけ（describe の中に置くと後続 describe の
// truncateAll が "Cannot use a pool after calling end on the pool" で落ちる）。
afterAll(async () => {
  await closeTestDb()
})

const UNIT_START = '2026-06-13'

async function setupUnit() {
  const group = await createEntryGroup()
  const day1 = await createEvent({ entryGroupId: group.id, eventDate: UNIT_START })
  const day2 = await createEvent({ entryGroupId: group.id, eventDate: '2026-06-14' })
  const units = buildTravelUnits([
    { id: day1.id, eventDate: day1.eventDate, status: day1.status },
    { id: day2.id, eventDate: day2.eventDate, status: day2.status },
  ])
  return { group, day1, day2, unit: units[0]! }
}

const target = (userId: string): TravelTarget => ({
  userId,
  name: userId,
  isGuest: false,
  attendanceDates: [UNIT_START],
  entered: false,
})

const route = {
  departureKind: 'sapporo' as const,
  departurePlace: null,
  returnKind: 'sapporo' as const,
  returnPlace: null,
  legs: [{ date: '2026-06-12', from: '札幌', to: '青森' }],
}

describe('saveTravelRoute', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('経路を保存し、再保存で上書きする（移動0行でも入力済み）', async () => {
    const { group, unit } = await setupUnit()
    const user = await createUser({ isCircleMember: true })
    await saveTravelRoute({
      entryGroupId: group.id,
      unit,
      targetUserId: user.id,
      actorUserId: user.id,
      targets: [target(user.id)],
      route,
    })
    const saved = await loadTravelRoute(group.id, unit.startDate, user.id)
    expect(saved?.legs).toEqual(route.legs)

    await saveTravelRoute({
      entryGroupId: group.id,
      unit,
      targetUserId: user.id,
      actorUserId: user.id,
      targets: [{ ...target(user.id), entered: true }],
      route: { ...route, returnKind: 'hometown', legs: [] },
    })
    const again = await loadTravelRoute(group.id, unit.startDate, user.id)
    expect(again?.returnKind).toBe('hometown')
    expect(again?.legs).toEqual([])
    const rows = await testDb.select().from(travelRoutes).where(eq(travelRoutes.entryGroupId, group.id))
    expect(rows).toHaveLength(1)
  })

  it('代理入力では savedBy に操作者、user_id に対象者が入る', async () => {
    const { group, unit } = await setupUnit()
    const member = await createUser({ isCircleMember: true })
    const submitter = await createUser({ isCircleMember: true, isTravelReportSubmitter: true })
    await saveTravelRoute({
      entryGroupId: group.id,
      unit,
      targetUserId: member.id,
      actorUserId: submitter.id,
      targets: [target(member.id), target(submitter.id)],
      route,
    })
    const saved = await loadTravelRoute(group.id, unit.startDate, member.id)
    expect(saved?.userId).toBe(member.id)
    expect(saved?.savedByUserId).toBe(submitter.id)
  })

  it('プロフィールの書き戻しは**対象者**に対して行われる（代理入力でも）', async () => {
    const { group, unit } = await setupUnit()
    const member = await createUser({ isCircleMember: true })
    const submitter = await createUser({ isCircleMember: true, isTravelReportSubmitter: true })
    await saveTravelRoute({
      entryGroupId: group.id,
      unit,
      targetUserId: member.id,
      actorUserId: submitter.id,
      targets: [target(member.id), target(submitter.id)],
      route,
      profile: { facultyKind: 'undergraduate', faculty: '法学部', schoolYear: '2年', phone: '090-0000-0001' },
    })
    const [updated] = await testDb.select().from(users).where(eq(users.id, member.id))
    expect(updated?.faculty).toBe('法学部')
    expect(updated?.schoolYear).toBe('2年')
    expect(updated?.phone).toBe('090-0000-0001')
    const [other] = await testDb.select().from(users).where(eq(users.id, submitter.id))
    expect(other?.faculty).toBeNull()
  })
})

describe('「全員そろった」の遷移判定（AC-18）', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  async function saveFor(
    group: { id: number },
    unit: { startDate: string; endDate: string; dates: string[]; eventIds: number[] },
    targets: TravelTarget[],
    userId: string,
  ) {
    return saveTravelRoute({
      entryGroupId: group.id,
      unit,
      targetUserId: userId,
      actorUserId: userId,
      targets,
      route,
    })
  }

  it('最後の1人が保存した瞬間だけ通知する（それ以前は送らない）', async () => {
    // 対象者は引数で渡す（対象者判定そのものは targets.ts の担当）。
    const { group, unit } = await setupUnit()
    const a = await createUser({ isCircleMember: true })
    const b = await createUser({ isCircleMember: true })
    const targets = [target(a.id), target(b.id)]

    const first = await saveFor(group, unit, targets, a.id)
    expect(first).toMatchObject({ allEntered: false, shouldNotify: false })

    const second = await saveFor(group, unit, targets, b.id)
    expect(second).toMatchObject({ allEntered: true, shouldNotify: true, memberCount: 2 })

    // claim（last_attempted_at）が tx 内で書かれている。
    const notices = await loadUnitNotices(group.id)
    expect(notices.get(unit.startDate)?.lastAttemptedAt).not.toBeNull()
    // 送信そのものは呼び出し側（コミット後）なので、この時点では未通知のまま。
    expect(notices.get(unit.startDate)?.allEnteredNotifiedAt ?? null).toBeNull()
  })

  it('既にそろっている状態の再保存では送らない', async () => {
    const { group, unit } = await setupUnit()
    const a = await createUser({ isCircleMember: true })
    const targets = [target(a.id)]
    expect(await saveFor(group, unit, targets, a.id)).toMatchObject({ shouldNotify: true })
    // 通知成功を記録してから再保存する。
    await testDb
      .update(travelUnitNotices)
      .set({ allEnteredNotifiedAt: new Date(), lastError: null })
      .where(eq(travelUnitNotices.entryGroupId, group.id))
    const again = await saveFor(group, unit, [{ ...target(a.id), entered: true }], a.id)
    expect(again).toMatchObject({ allEntered: true, shouldNotify: false })
  })

  it('対象者が増えて未完了に戻り、再びそろえば再送する', async () => {
    const { group, unit } = await setupUnit()
    const a = await createUser({ isCircleMember: true })
    const b = await createUser({ isCircleMember: true })
    expect(await saveFor(group, unit, [target(a.id)], a.id)).toMatchObject({ shouldNotify: true })
    await testDb
      .update(travelUnitNotices)
      .set({ allEnteredNotifiedAt: new Date(), lastError: null })
      .where(eq(travelUnitNotices.entryGroupId, group.id))

    // 繰り上がりで b が対象者に加わった → b の保存で再び遷移する。
    const after = await saveFor(group, unit, [target(a.id), target(b.id)], b.id)
    expect(after).toMatchObject({ allEntered: true, shouldNotify: true, memberCount: 2 })
  })

  it('★自己回復: 前回の送信が失敗していれば、遷移でなくても再送する', async () => {
    const { group, unit } = await setupUnit()
    const a = await createUser({ isCircleMember: true })
    await saveFor(group, unit, [target(a.id)], a.id)
    // 送信失敗を記録（通知済みにはしない）。
    await testDb
      .update(travelUnitNotices)
      .set({ lastError: 'LINE 送信に失敗しました' })
      .where(eq(travelUnitNotices.entryGroupId, group.id))

    // 未入力集合が空なので遷移ではないが、last_error があるので再送する。
    const again = await saveFor(group, unit, [{ ...target(a.id), entered: true }], a.id)
    expect(again).toMatchObject({ allEntered: true, shouldNotify: true })
  })

  it('対象者が0人なら通知しない', async () => {
    const { group, unit } = await setupUnit()
    const a = await createUser({ isCircleMember: true })
    const result = await saveTravelRoute({
      entryGroupId: group.id,
      unit,
      targetUserId: a.id,
      actorUserId: a.id,
      targets: [],
      route,
    })
    expect(result).toMatchObject({ allEntered: false, shouldNotify: false, memberCount: 0 })
  })

  it('通知記録は (グループ, 単位初日) ごとに分かれる', async () => {
    const { group, unit } = await setupUnit()
    const a = await createUser({ isCircleMember: true })
    await saveFor(group, unit, [target(a.id)], a.id)
    const rows = await testDb
      .select()
      .from(travelUnitNotices)
      .where(
        and(
          eq(travelUnitNotices.entryGroupId, group.id),
          eq(travelUnitNotices.unitStartDate, unit.startDate),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.notifiedMemberCount).toBe(1)
  })
})
