import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { entryGroupTravelSettings, travelRoutes } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createEventAttendance, createUser } from '@/test-utils/seed'
import { loadTravelRouteAlerts } from './alerts'

// travel-report タスク7 (S9・AC-17): ホームの「遠征経路 未入力」導線。

describe('loadTravelRouteAlerts', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  const TODAY = '2030-01-01'

  /** 「経路入力が開いている・必要」なグループ＋対象者1名のイベントを作る共通セットアップ。 */
  async function setupOpenGroup(overrides: { eventDate?: string } = {}) {
    const { id: entryGroupId } = await createEntryGroup()
    const event = await createEvent({
      entryGroupId,
      eventDate: overrides.eventDate ?? TODAY,
      title: '十和田大会 A級',
    })
    const target = await createUser({ isCircleMember: true, grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: target.id, attend: true })
    await testDb
      .insert(entryGroupTravelSettings)
      .values({ entryGroupId, routeInputStartedAt: new Date() })
    return { entryGroupId, event, target }
  }

  it('対象者で未入力なら出る', async () => {
    const { entryGroupId, event, target } = await setupOpenGroup()

    const alerts = await loadTravelRouteAlerts(target.id, TODAY)

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      unitKey: event.eventDate,
      entryGroupId,
      tournamentName: '十和田大会 A級',
      unitDates: [event.eventDate],
      routeEventId: event.id,
    })
  })

  it('入力済みなら出ない', async () => {
    const { entryGroupId, event, target } = await setupOpenGroup()
    await testDb.insert(travelRoutes).values({
      entryGroupId,
      unitStartDate: event.eventDate,
      userId: target.id,
      departureKind: 'sapporo',
      returnKind: 'sapporo',
      legs: [],
    })

    const alerts = await loadTravelRouteAlerts(target.id, TODAY)

    expect(alerts).toEqual([])
  })

  it('単位の最終日を過ぎたら出ない', async () => {
    const { target } = await setupOpenGroup({ eventDate: '2029-12-31' })

    // today が単位の最終日より後
    const alerts = await loadTravelRouteAlerts(target.id, TODAY)

    expect(alerts).toEqual([])
  })

  it('進行中の複数日単位で本人の出場日が前日だけでも、単位の最終日を過ぎていなければ出る（Codex R1 #5）', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const yesterday = await createEvent({
      entryGroupId,
      eventDate: '2029-12-31',
      title: '十和田大会 A級',
    })
    const todayEvent = await createEvent({
      entryGroupId,
      eventDate: TODAY,
      title: '十和田大会 A級',
    })
    const target = await createUser({ isCircleMember: true, grade: 'A' })
    // 本人は単位の初日（昨日）だけ出場する。今日は出場しない。
    await createEventAttendance({ eventId: yesterday.id, userId: target.id, attend: true })
    await testDb
      .insert(entryGroupTravelSettings)
      .values({ entryGroupId, routeInputStartedAt: new Date() })

    const alerts = await loadTravelRouteAlerts(target.id, TODAY)

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      unitKey: yesterday.eventDate,
      entryGroupId,
      unitDates: [yesterday.eventDate, todayEvent.eventDate],
    })
  })

  it('「不要」なら出ない', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId, eventDate: TODAY })
    const target = await createUser({ isCircleMember: true, grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: target.id, attend: true })
    await testDb
      .insert(entryGroupTravelSettings)
      .values({ entryGroupId, required: false, routeInputStartedAt: new Date() })

    const alerts = await loadTravelRouteAlerts(target.id, TODAY)

    expect(alerts).toEqual([])
  })

  it('経路入力が未開始（確定名簿なし・開始ボタン未押下）なら出ない', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId, eventDate: TODAY })
    const target = await createUser({ isCircleMember: true, grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: target.id, attend: true })
    // entryGroupTravelSettings 行を作らない = 既定（必要・未開始）

    const alerts = await loadTravelRouteAlerts(target.id, TODAY)

    expect(alerts).toEqual([])
  })

  it('対象者でない人には出ない（出欠「参加」でない・サークル非所属を含む）', async () => {
    const { event } = await setupOpenGroup()
    const notAttending = await createUser({ isCircleMember: true, grade: 'B' })
    const notCircleMember = await createUser({ isCircleMember: false, grade: 'C' })
    await createEventAttendance({ eventId: event.id, userId: notCircleMember.id, attend: true })

    expect(await loadTravelRouteAlerts(notAttending.id, TODAY)).toEqual([])
    expect(await loadTravelRouteAlerts(notCircleMember.id, TODAY)).toEqual([])
  })
})
