import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { countGroupEntrants, formatEntrantCountParts } from './entry-headcount'

async function attend(eventId: number, userId: string, value = true) {
  await createEventAttendance({ eventId, userId, attend: value })
}

describe('countGroupEntrants', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('複数日に出る同じ会員を1人として数える（実人数・重複排除）', async () => {
    const group = await createEntryGroup()
    const day1 = await createEvent({ entryGroupId: group.id, eventDate: '2026-08-01' })
    const day2 = await createEvent({ entryGroupId: group.id, eventDate: '2026-08-08' })
    const user = await createUser({ name: 'both-days' })
    await attend(day1.id, user.id)
    await attend(day2.id, user.id)

    expect(await countGroupEntrants(testDb, group.id)).toEqual({ total: 1, guests: 0 })
  })

  it('ゲストを含めて数え、内訳を返す（AC-24）', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const member = await createUser({ name: 'hc-member' })
    const guest = await createUser({ name: 'hc-guest', role: 'guest' })
    await attend(day.id, member.id)
    await attend(day.id, guest.id)

    expect(await countGroupEntrants(testDb, group.id)).toEqual({ total: 2, guests: 1 })
  })

  it('不参加・未回答は数えない', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id })
    const yes = await createUser({ name: 'hc-yes' })
    const no = await createUser({ name: 'hc-no' })
    await createUser({ name: 'hc-silent' })
    await attend(day.id, yes.id)
    await attend(day.id, no.id, false)

    expect(await countGroupEntrants(testDb, group.id)).toEqual({ total: 1, guests: 0 })
  })

  it('対象級外の会員は数えない（eligible_grades フィルタ）', async () => {
    const group = await createEntryGroup()
    const day = await createEvent({ entryGroupId: group.id, eligibleGrades: ['A'] })
    const a = await createUser({ name: 'hc-a', grade: 'A' })
    const c = await createUser({ name: 'hc-c', grade: 'C' })
    await attend(day.id, a.id)
    await attend(day.id, c.id)

    expect(await countGroupEntrants(testDb, group.id)).toEqual({ total: 1, guests: 0 })
  })

  it('中止した日は数えない', async () => {
    const group = await createEntryGroup()
    const cancelled = await createEvent({ entryGroupId: group.id, status: 'cancelled' })
    const user = await createUser({ name: 'hc-cancelled' })
    await attend(cancelled.id, user.id)

    expect(await countGroupEntrants(testDb, group.id)).toEqual({ total: 0, guests: 0 })
  })
})

describe('formatEntrantCountParts', () => {
  it('ゲストが居れば「内他会」を併記する', () => {
    expect(formatEntrantCountParts({ total: 12, guests: 3 })).toEqual({
      template: '%s名（内他会%s名）',
      values: [12, 3],
    })
  })

  it('ゲストが0名なら括弧ごと省略する（AC-24）', () => {
    expect(formatEntrantCountParts({ total: 12, guests: 0 })).toEqual({
      template: '%s名',
      values: [12],
    })
  })
})
