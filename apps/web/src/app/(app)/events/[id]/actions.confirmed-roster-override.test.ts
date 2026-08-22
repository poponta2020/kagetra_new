import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { entryGroups } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createGuest,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'

/**
 * confirmed-roster-signal タスク2: 「確定名簿ありとして扱う」手動フラグの
 * Server Action。認可（AC-12）と、ON/OFF が判定へそのまま出ること（AC-6/AC-7）。
 * トグル UI の非表示（AC-11）は各ページの page.test.tsx が持つ。
 */

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { setConfirmedRosterOverride } = await import('./actions')

async function readOverride(entryGroupId: number): Promise<boolean> {
  const [row] = await testDb
    .select({ override: entryGroups.confirmedRosterOverride })
    .from(entryGroups)
    .where(eq(entryGroups.id, entryGroupId))
  return row!.override
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('setConfirmedRosterOverride — 認可 (AC-12)', () => {
  it('admin は成功する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()

    await setConfirmedRosterOverride(group.id, true)

    expect(await readOverride(group.id)).toBe(true)
  })

  it('vice_admin は成功する', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })
    const group = await createEntryGroup()

    await setConfirmedRosterOverride(group.id, true)

    expect(await readOverride(group.id)).toBe(true)
  })

  it('member は Forbidden で拒否され、値も変わらない', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const group = await createEntryGroup()

    await expect(setConfirmedRosterOverride(group.id, true)).rejects.toThrow(
      'Forbidden',
    )
    expect(await readOverride(group.id)).toBe(false)
  })

  it('guest は Forbidden で拒否される', async () => {
    const guest = await createGuest()
    await setAuthSession({ id: guest.id, role: 'guest' })
    const group = await createEntryGroup()

    await expect(setConfirmedRosterOverride(group.id, true)).rejects.toThrow(
      'Forbidden',
    )
    expect(await readOverride(group.id)).toBe(false)
  })

  it('未ログインは Unauthorized で拒否される', async () => {
    await setAuthSession(null)
    const group = await createEntryGroup()

    await expect(setConfirmedRosterOverride(group.id, true)).rejects.toThrow(
      'Unauthorized',
    )
    expect(await readOverride(group.id)).toBe(false)
  })

  // 存在しない id への UPDATE を無言で 0 行にしない（グループ実在確認）。
  it('存在しないグループ id は Not found', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await expect(setConfirmedRosterOverride(999999, true)).rejects.toThrow(
      'Not found',
    )
  })
})

describe('setConfirmedRosterOverride — 判定への反映 (AC-6/AC-7)', () => {
  beforeEach(async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
  })

  it('ON で「確定名簿あり」になり、OFF で戻る', async () => {
    const group = await createEntryGroup()
    expect((await loadConfirmedRosterState(group.id)).settled).toBe(false)

    await setConfirmedRosterOverride(group.id, true)
    expect(await loadConfirmedRosterState(group.id)).toEqual({
      settled: true,
      override: true,
    })

    await setConfirmedRosterOverride(group.id, false)
    expect(await loadConfirmedRosterState(group.id)).toEqual({
      settled: false,
      override: false,
    })
  })

  it('他グループのフラグは巻き込まない', async () => {
    const target = await createEntryGroup()
    const other = await createEntryGroup()

    await setConfirmedRosterOverride(target.id, true)

    expect(await readOverride(target.id)).toBe(true)
    expect(await readOverride(other.id)).toBe(false)
  })

  it('グループ内の全日の詳細パスを revalidate する', async () => {
    const { revalidatePath } = await import('next/cache')
    const group = await createEntryGroup()
    const day1 = await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05' })
    const day2 = await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06' })
    vi.mocked(revalidatePath).mockClear()

    await setConfirmedRosterOverride(group.id, true)

    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
    expect(paths).toContain(`/events/${day1.id}`)
    expect(paths).toContain(`/events/${day2.id}`)
    expect(paths).toContain(`/admin/entries/${group.id}`)
    expect(paths).toContain('/admin/entries')
  })
})
