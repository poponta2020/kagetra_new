import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { eventAttendances, eventLifecycleNotifications } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Import under test AFTER mocks so @/auth resolves to the mock.
const { adminAddAttendee, adminRemoveAttendee } = await import('./actions')

/**
 * admin-attendance-edit タスク1: 管理者による参加者の代理追加・削除。
 *
 * 要件 §4 の AC-1〜AC-7 と、AC-8 のうちサーバー側の判定をここで固定する
 * （UI 側の描画は components/events/attendance-edit-section.test.tsx）。
 */
async function findAttendance(eventId: number, userId: string) {
  return testDb.query.eventAttendances.findFirst({
    where: and(eq(eventAttendances.eventId, eventId), eq(eventAttendances.userId, userId)),
  })
}

describe('adminAddAttendee / adminRemoveAttendee', () => {
  beforeEach(async () => {
    await truncateAll()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  describe('追加（AC-1 / AC-2 / AC-3 / AC-6）', () => {
    it('管理者は対象級内の会員を参加者として追加できる', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: ['A', 'B'] })
      const member = await createUser({ grade: 'B' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminAddAttendee(event.id, member.id)

      expect((await findAttendance(event.id, member.id))?.attend).toBe(true)
    })

    it('副管理者も追加できる', async () => {
      const viceAdmin = await createViceAdmin()
      const event = await createEvent({ eligibleGrades: null })
      const member = await createUser()
      await setAuthSession({ id: viceAdmin.id, role: 'vice_admin' })

      await adminAddAttendee(event.id, member.id)

      expect((await findAttendance(event.id, member.id))?.attend).toBe(true)
    })

    it('ゲスト・管理者ロールのユーザーも追加できる（ロール不問）', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: ['A'] })
      const guest = await createGuest({ grade: 'A' })
      const otherAdmin = await createAdmin({ grade: 'A' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminAddAttendee(event.id, guest.id)
      await adminAddAttendee(event.id, otherAdmin.id)

      expect((await findAttendance(event.id, guest.id))?.attend).toBe(true)
      expect((await findAttendance(event.id, otherAdmin.id))?.attend).toBe(true)
    })

    it('対象級外のユーザーは拒否される', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: ['A', 'B'] })
      const outOfGrade = await createUser({ grade: 'D' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(adminAddAttendee(event.id, outOfGrade.id)).rejects.toThrow(
        'この大会の対象会員ではありません',
      )
      expect(await findAttendance(event.id, outOfGrade.id)).toBeUndefined()
    })

    it('級未設定のユーザーは対象級ありの大会には追加できない', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: ['A'] })
      const noGrade = await createUser({ grade: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(adminAddAttendee(event.id, noGrade.id)).rejects.toThrow(
        'この大会の対象会員ではありません',
      )
    })

    it('isInvited=false のユーザーは拒否される', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: null })
      const notInvited = await createUser({ isInvited: false })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(adminAddAttendee(event.id, notInvited.id)).rejects.toThrow(
        'この大会の対象会員ではありません',
      )
    })

    it('存在しないユーザー ID は拒否される', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(adminAddAttendee(event.id, 'no-such-user')).rejects.toThrow(
        'この大会の対象会員ではありません',
      )
    })

    it('存在しないイベント ID は拒否される', async () => {
      const admin = await createAdmin()
      const member = await createUser()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(adminAddAttendee(999999, member.id)).rejects.toThrow('Event not found')
    })

    it('「不参加」回答済みの行は attend が反転し、既存コメントは保持される', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: null })
      const member = await createUser()
      await createEventAttendance({
        eventId: event.id,
        userId: member.id,
        attend: false,
        comment: '仕事のため欠席',
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminAddAttendee(event.id, member.id)

      const row = await findAttendance(event.id, member.id)
      expect(row?.attend).toBe(true)
      expect(row?.comment).toBe('仕事のため欠席')
    })

    it('会内締切後・開催日後でも追加できる', async () => {
      const admin = await createAdmin()
      const event = await createEvent({
        eventDate: '2020-01-01',
        internalDeadline: '2019-12-01',
        entryDeadline: '2019-12-10',
        eligibleGrades: null,
      })
      const member = await createUser()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminAddAttendee(event.id, member.id)

      expect((await findAttendance(event.id, member.id))?.attend).toBe(true)
    })

    it('申込なし（not_applying）の大会でも追加できる', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ entryStatus: 'not_applying', eligibleGrades: null })
      const member = await createUser()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminAddAttendee(event.id, member.id)

      expect((await findAttendance(event.id, member.id))?.attend).toBe(true)
    })
  })

  describe('削除（AC-4 / AC-8）', () => {
    it('attend=true の行を削除して「未回答」に戻す', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: null })
      const member = await createUser()
      await createEventAttendance({
        eventId: event.id,
        userId: member.id,
        comment: 'よろしく',
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminRemoveAttendee(event.id, member.id)

      expect(await findAttendance(event.id, member.id)).toBeUndefined()
    })

    it('attend=false（不参加回答）の行は消さない', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: null })
      const member = await createUser()
      await createEventAttendance({ eventId: event.id, userId: member.id, attend: false })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminRemoveAttendee(event.id, member.id)

      expect((await findAttendance(event.id, member.id))?.attend).toBe(false)
    })

    it('対象級外の stale な参加行も削除できる（候補条件で検証しない）', async () => {
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: ['A'] })
      const outOfGrade = await createUser({ grade: 'D' })
      await createEventAttendance({ eventId: event.id, userId: outOfGrade.id })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminRemoveAttendee(event.id, outOfGrade.id)

      expect(await findAttendance(event.id, outOfGrade.id)).toBeUndefined()
    })

    it('存在しないイベント ID は拒否される', async () => {
      const admin = await createAdmin()
      const member = await createUser()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(adminRemoveAttendee(999999, member.id)).rejects.toThrow('Event not found')
    })
  })

  describe('認可（AC-5）', () => {
    it('一般会員は追加・削除ともに拒否される', async () => {
      const member = await createUser()
      const target = await createUser()
      const event = await createEvent({ eligibleGrades: null })
      await createEventAttendance({ eventId: event.id, userId: target.id })
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(adminAddAttendee(event.id, target.id)).rejects.toThrow('Forbidden')
      await expect(adminRemoveAttendee(event.id, target.id)).rejects.toThrow('Forbidden')
      expect((await findAttendance(event.id, target.id))?.attend).toBe(true)
    })

    it('ゲストは追加・削除ともに拒否される', async () => {
      const guest = await createGuest()
      const target = await createUser()
      const event = await createEvent({ eligibleGrades: null })
      await setAuthSession({ id: guest.id, role: 'guest' })

      await expect(adminAddAttendee(event.id, target.id)).rejects.toThrow('Forbidden')
      await expect(adminRemoveAttendee(event.id, target.id)).rejects.toThrow('Forbidden')
      expect(await findAttendance(event.id, target.id)).toBeUndefined()
    })

    it('未ログインは拒否される', async () => {
      const target = await createUser()
      const event = await createEvent({ eligibleGrades: null })
      await setAuthSession(null)

      await expect(adminAddAttendee(event.id, target.id)).rejects.toThrow('Unauthorized')
      await expect(adminRemoveAttendee(event.id, target.id)).rejects.toThrow('Unauthorized')
    })
  })

  describe('通知（AC-7）', () => {
    it('追加・削除で LINE push も lifecycle 通知 claim も発生しない', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const admin = await createAdmin()
      const event = await createEvent({ eligibleGrades: null })
      const member = await createUser()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await adminAddAttendee(event.id, member.id)
      await adminRemoveAttendee(event.id, member.id)

      expect(fetchSpy).not.toHaveBeenCalled()
      const notifications = await testDb
        .select()
        .from(eventLifecycleNotifications)
        .where(eq(eventLifecycleNotifications.eventId, event.id))
      expect(notifications).toHaveLength(0)
    })
  })
})
