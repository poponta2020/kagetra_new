import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Grade } from '@kagetra/shared/types'
import {
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
} from '@/test-utils/seed'
import { getUpcomingEntrants, type UpcomingEntrantsEvent } from './upcoming-entrants'

/**
 * `getUpcomingEntrants` の母集団・確定/希望の切り替え・ゲスト合流・dedupe・
 * since 境界。ホーム `/dashboard` と外部向け出場者 API が共有する導出の
 * ユニットテスト（実装手順書 タスク1）。
 *
 * ホーム側の表示分岐（並び順・チップ表記等）は `dashboard/page.test.tsx` が
 * 引き続き持つ（この切り出しで無変更）。
 */

/** 姓が `familyName` の会員を作る（`users.name` は UNIQUE なので名で散らす）。 */
let memberSeq = 0
async function createMember(familyName: string, overrides: Parameters<typeof createUser>[0] = {}) {
  memberSeq += 1
  return createUser({ name: `${familyName} 太郎${memberSeq}`, ...overrides })
}

/** 確定名簿を 1 版作り、行を積む。 */
async function seedConfirmedRoster(
  entryGroupId: number,
  entries: {
    userId: string | null
    grade?: Grade | null
    status?: 'confirmed' | 'carried_up' | 'carry_up_declined' | 'cancelled' | 'applied'
    selectionOutcome?: 'accepted' | 'waitlisted' | 'rejected' | 'unknown'
  }[],
) {
  const [roster] = await testDb
    .insert(tournamentEntryRosters)
    .values({ entryGroupId, rosterType: 'confirmed', version: 1 })
    .returning()
  for (const e of entries) {
    await testDb.insert(tournamentEntryRosterEntries).values({
      rosterId: roster!.id,
      userId: e.userId,
      grade: e.grade ?? null,
      rawName: 'raw name',
      status: e.status ?? 'confirmed',
      selectionOutcome: e.selectionOutcome ?? 'unknown',
    })
  }
  return roster!
}

function findEvent(
  result: UpcomingEntrantsEvent[],
  eventId: number,
): UpcomingEntrantsEvent {
  const found = result.find((e) => e.id === eventId)
  if (!found) throw new Error(`event not found: ${eventId}`)
  return found
}

describe('getUpcomingEntrants', () => {
  beforeEach(async () => {
    await truncateAll()
    memberSeq = 0
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('確定名簿パス: confirmed/carried_up ∧ 非 waitlisted/rejected ∧ user_id 非 NULL ∧ 非 guest の行だけが basis=roster で載る', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      title: '確定パステスト',
      eventDate: '2030-03-01',
      entryGroupId: group.id,
    })

    const shussen = await createMember('出場', { grade: 'C' })
    const hoketsu = await createMember('補欠', { grade: 'C' })
    const rakusen = await createMember('落選', { grade: 'C' })
    const guest = await createGuest({ name: '客人 太郎', grade: 'C' })

    await seedConfirmedRoster(group.id, [
      { userId: shussen.id, grade: 'C', status: 'confirmed' },
      {
        userId: hoketsu.id,
        grade: 'C',
        status: 'confirmed',
        selectionOutcome: 'waitlisted',
      },
      {
        userId: rakusen.id,
        grade: 'C',
        status: 'confirmed',
        selectionOutcome: 'rejected',
      },
      // 会員として同定できていない行（他会選手）。
      { userId: null, grade: 'C', status: 'confirmed' },
      // 現在 role=guest の行（登録会が変わった名残）は名簿由来からは落ちる。
      { userId: guest.id, grade: 'C', status: 'confirmed' },
    ])

    const result = await getUpcomingEntrants({ since: '2030-01-01' })
    const found = findEvent(result, event.id)
    expect(found.hasConfirmedRoster).toBe(true)

    const userIds = found.entrants.map((e) => e.userId)
    expect(userIds).toEqual([shussen.id])
    expect(found.entrants.every((e) => e.basis === 'roster')).toBe(true)
  })

  it('希望パス（確定名簿なし）: attend=true ∧ is_invited ∧ 対象級内が basis=attendance で載る', async () => {
    const event = await createEvent({
      title: '希望パステスト',
      eventDate: '2030-03-01',
      eligibleGrades: ['C', 'D'],
    })

    const sanka = await createMember('参加', { grade: 'C' })
    const fusanka = await createMember('不参', { grade: 'C' })
    const kyugai = await createMember('級外', { grade: 'B' })
    const michoutai = await createMember('未招', { grade: 'C', isInvited: false })

    await createEventAttendance({ eventId: event.id, userId: sanka.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: fusanka.id, attend: false })
    await createEventAttendance({ eventId: event.id, userId: kyugai.id, attend: true })
    await createEventAttendance({
      eventId: event.id,
      userId: michoutai.id,
      attend: true,
    })

    const result = await getUpcomingEntrants({ since: '2030-01-01' })
    const found = findEvent(result, event.id)
    expect(found.hasConfirmedRoster).toBe(false)
    expect(found.entrants.map((e) => e.userId)).toEqual([sanka.id])
    expect(found.entrants[0]?.basis).toBe('attendance')
  })

  it('ゲスト合流: 確定名簿があるグループでも guest の attend=true 回答者が basis=attendance で合流する', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      title: 'ゲスト合流テスト',
      eventDate: '2030-03-01',
      eligibleGrades: ['C', 'D'],
      entryGroupId: group.id,
    })

    const meibo = await createMember('名簿', { grade: 'C' })
    await seedConfirmedRoster(group.id, [{ userId: meibo.id, grade: 'C', status: 'confirmed' }])

    const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

    const result = await getUpcomingEntrants({ since: '2030-01-01' })
    const found = findEvent(result, event.id)
    expect(found.hasConfirmedRoster).toBe(true)

    const guestEntrant = found.entrants.find((e) => e.userId === guest.id)
    expect(guestEntrant).toBeDefined()
    expect(guestEntrant?.basis).toBe('attendance')
    expect(guestEntrant?.isGuest).toBe(true)

    const meiboEntrant = found.entrants.find((e) => e.userId === meibo.id)
    expect(meiboEntrant?.basis).toBe('roster')
    expect(meiboEntrant?.isGuest).toBe(false)

    expect(found.entrants).toHaveLength(2)
  })

  it('dedupe: 名簿に確定している会員が同じイベントに attend=true でも 1 件（roster が勝つ）', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      title: 'dedupeテスト',
      eventDate: '2030-03-01',
      eligibleGrades: ['C', 'D'],
      entryGroupId: group.id,
    })

    const member = await createMember('両属', { grade: 'C' })
    await seedConfirmedRoster(group.id, [{ userId: member.id, grade: 'C', status: 'confirmed' }])
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    const result = await getUpcomingEntrants({ since: '2030-01-01' })
    const found = findEvent(result, event.id)

    const entries = found.entrants.filter((e) => e.userId === member.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.basis).toBe('roster')
  })

  it('since 境界: since より前は返らない・当日は返る・団体戦/中止は返らない', async () => {
    const before = await createEvent({ title: '境界前', eventDate: '2030-05-31' })
    const boundary = await createEvent({ title: '境界当日', eventDate: '2030-06-01' })
    const after = await createEvent({ title: '境界後', eventDate: '2030-06-02' })
    const team = await createEvent({
      title: '団体戦',
      eventDate: '2030-06-02',
      kind: 'team',
    })
    const cancelled = await createEvent({
      title: '中止',
      eventDate: '2030-06-02',
      status: 'cancelled',
    })

    const result = await getUpcomingEntrants({ since: '2030-06-01' })
    const ids = result.map((e) => e.id)

    expect(ids).not.toContain(before.id)
    expect(ids).toContain(boundary.id)
    expect(ids).toContain(after.id)
    expect(ids).not.toContain(team.id)
    expect(ids).not.toContain(cancelled.id)
  })

  it('0名イベントがイベントとして返る（entrants: []）', async () => {
    const event = await createEvent({
      title: '誰も出ない大会',
      eventDate: '2030-03-01',
    })

    const result = await getUpcomingEntrants({ since: '2030-01-01' })
    const found = findEvent(result, event.id)
    expect(found.entrants).toEqual([])
    expect(found.hasConfirmedRoster).toBe(false)
  })

  it('entryGrade と userGrade の分離: 名簿行の級と現在の級が異なる場合に両方が正しく入り、kana も返る', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      title: '級分離テスト',
      eventDate: '2030-03-01',
      entryGroupId: group.id,
    })

    const shokyu = await createMember('昇級', {
      grade: 'B',
      familyKana: 'ショウキュウ',
      givenKana: 'タロウ',
    })
    await seedConfirmedRoster(group.id, [{ userId: shokyu.id, grade: 'C', status: 'confirmed' }])

    const result = await getUpcomingEntrants({ since: '2030-01-01' })
    const found = findEvent(result, event.id)
    const entrant = found.entrants.find((e) => e.userId === shokyu.id)

    expect(entrant?.entryGrade).toBe('C')
    expect(entrant?.userGrade).toBe('B')
    expect(entrant?.familyKana).toBe('ショウキュウ')
    expect(entrant?.givenKana).toBe('タロウ')
  })
})
