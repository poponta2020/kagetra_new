import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { entryGroupSelectionStatuses } from '@kagetra/shared/schema'
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
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// travel-report タスク3 (AC-8/AC-9): 確定状況の保存・初期化。
// 保存できるのは管理者・副管理者のみ（requirements §3.2 R12）。副連絡責任者は
// このタスクの範囲外（フラグ自体はタスク2 が導入する）なので、ここでは
// admin/vice_admin と一般会員・未ログインの境界だけを検証する。

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { saveSelectionStatuses, resetSelectionStatuses } = await import('./travel-report-actions')

async function manualStatusOf(entryGroupId: number, userId: string) {
  const [row] = await testDb
    .select({ status: entryGroupSelectionStatuses.status })
    .from(entryGroupSelectionStatuses)
    .where(
      and(
        eq(entryGroupSelectionStatuses.entryGroupId, entryGroupId),
        eq(entryGroupSelectionStatuses.userId, userId),
      ),
    )
  return row?.status ?? null
}

// ★`afterAll` は**トップレベルに1つだけ**置く。describe の中に置くと、その describe が
// 終わった時点でプールが閉じ、後続の describe の `truncateAll` が
// "Cannot use a pool after calling end on the pool" で落ちる。
afterAll(async () => {
  await closeTestDb()
})

describe('saveSelectionStatuses', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('管理者は出欠「参加」の会員・ゲストの確定状況を保存できる（AC-8）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const member = await createUser({ grade: 'A' })
    const guest = await createGuest({ grade: 'B' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

    await saveSelectionStatuses(groupId, [
      { userId: member.id, status: 'waitlisted' },
      { userId: guest.id, status: 'not_participating' },
    ])

    expect(await manualStatusOf(groupId, member.id)).toBe('waitlisted')
    expect(await manualStatusOf(groupId, guest.id)).toBe('not_participating')
  })

  it('副管理者も保存できる', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const member = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    await saveSelectionStatuses(groupId, [{ userId: member.id, status: 'confirmed' }])

    expect(await manualStatusOf(groupId, member.id)).toBe('confirmed')
  })

  it('再保存で既存の手入力行を上書きする（onConflictDoUpdate）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const member = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    await saveSelectionStatuses(groupId, [{ userId: member.id, status: 'waitlisted' }])
    await saveSelectionStatuses(groupId, [{ userId: member.id, status: 'confirmed' }])

    expect(await manualStatusOf(groupId, member.id)).toBe('confirmed')
  })

  it('一般会員は拒否される（Forbidden）', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const target = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: target.id, attend: true })

    await expect(
      saveSelectionStatuses(groupId, [{ userId: target.id, status: 'confirmed' }]),
    ).rejects.toThrow('Forbidden')
    expect(await manualStatusOf(groupId, target.id)).toBeNull()
  })

  it('未ログインは拒否される（Unauthorized）', async () => {
    await setAuthSession(null)
    const { id: groupId } = await createEntryGroup()

    await expect(
      saveSelectionStatuses(groupId, [{ userId: 'nobody', status: 'confirmed' }]),
    ).rejects.toThrow('Unauthorized')
  })

  it('存在しないグループは拒否される', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await expect(
      saveSelectionStatuses(999999, [{ userId: admin.id, status: 'confirmed' }]),
    ).rejects.toThrow('申込グループが見つかりません')
  })

  it('対象者（出欠「参加」の会員・ゲスト）に含まれない userId は fail-closed で全体を拒否する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const eligible = await createUser({ grade: 'A' })
    const notEligible = await createUser({ grade: 'B' }) // 出欠していない
    await createEventAttendance({ eventId: event.id, userId: eligible.id, attend: true })

    await expect(
      saveSelectionStatuses(groupId, [
        { userId: eligible.id, status: 'confirmed' },
        { userId: notEligible.id, status: 'confirmed' },
      ]),
    ).rejects.toThrow('対象外の会員が含まれています')
    // 部分保存されていない（fail-closed）。
    expect(await manualStatusOf(groupId, eligible.id)).toBeNull()
  })

  it('不正な status 値は zod で拒否される', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()

    await expect(
      saveSelectionStatuses(groupId, [
        // @ts-expect-error 実行時の不正値を検証する
        { userId: admin.id, status: 'bogus' },
      ]),
    ).rejects.toThrow()
  })

  it('空配列は拒否される（保存対象なしを黙って成功扱いにしない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()

    await expect(saveSelectionStatuses(groupId, [])).rejects.toThrow('保存する行がありません')
  })
})

describe('resetSelectionStatuses', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('手入力行を DELETE する（取込名簿の結果に戻す。R3）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const member = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })
    await saveSelectionStatuses(groupId, [{ userId: member.id, status: 'waitlisted' }])
    expect(await manualStatusOf(groupId, member.id)).toBe('waitlisted')

    await resetSelectionStatuses(groupId)

    expect(await manualStatusOf(groupId, member.id)).toBeNull()
  })

  it('一般会員は拒否される', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { id: groupId } = await createEntryGroup()

    await expect(resetSelectionStatuses(groupId)).rejects.toThrow('Forbidden')
  })

  it('未ログインは拒否される', async () => {
    await setAuthSession(null)
    const { id: groupId } = await createEntryGroup()

    await expect(resetSelectionStatuses(groupId)).rejects.toThrow('Unauthorized')
  })
})
