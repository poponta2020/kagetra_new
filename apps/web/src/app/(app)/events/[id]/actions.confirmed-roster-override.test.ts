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
 * 個人戦の日を1件持つグループ。ON は「グループの全日が個人戦」のときだけ許されるので
 * （名簿は個人戦専用の仕様）、成功系のシードはイベント0件のグループを使えない。
 */
async function createIndividualGroup() {
  const group = await createEntryGroup()
  await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05', kind: 'individual' })
  return group
}

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
    const group = await createIndividualGroup()

    await setConfirmedRosterOverride(group.id, true)

    expect(await readOverride(group.id)).toBe(true)
  })

  it('vice_admin は成功する', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })
    const group = await createIndividualGroup()

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
    const group = await createIndividualGroup()
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
    const target = await createIndividualGroup()
    const other = await createIndividualGroup()

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

/**
 * confirmed-roster-signal r1 review: 名簿（＝この手動フラグ）は個人戦専用の仕様。
 * 日ページの `RosterSection` は**その日の** `kind` で描かれるため、個人戦と団体戦が
 * 混在するグループでは個人戦の日からトグルへ到達できてしまう。UI で塞ぐだけでなく、
 * Action ID 直叩きにも耐えるようサーバー側でも fail-closed にする。
 */
describe('setConfirmedRosterOverride — 個人戦グループ限定のガード', () => {
  beforeEach(async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
  })

  it('団体戦の日を含むグループでは ON にできない', async () => {
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05', kind: 'individual' })
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06', kind: 'team' })

    await expect(setConfirmedRosterOverride(group.id, true)).rejects.toThrow(
      '団体戦を含む申込グループ',
    )
    expect(await readOverride(group.id)).toBe(false)
  })

  it('全日が団体戦のグループでも ON にできない', async () => {
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05', kind: 'team' })

    await expect(setConfirmedRosterOverride(group.id, true)).rejects.toThrow(
      '団体戦を含む申込グループ',
    )
  })

  it('イベント0件のグループでも ON にできない（fail-closed）', async () => {
    const group = await createEntryGroup()

    await expect(setConfirmedRosterOverride(group.id, true)).rejects.toThrow(
      '団体戦を含む申込グループ',
    )
  })

  // ★OFF は常に許可する。立てた後に団体戦の日が加わると UI から到達できなくなるので、
  //   ここまで塞ぐと解除不能な状態を作ってしまう。
  it('ON の後にグループへ団体戦の日が加わっても OFF には戻せる', async () => {
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05', kind: 'individual' })
    await setConfirmedRosterOverride(group.id, true)
    expect(await readOverride(group.id)).toBe(true)

    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06', kind: 'team' })

    await setConfirmedRosterOverride(group.id, false)
    expect(await readOverride(group.id)).toBe(false)
  })

  it('全日が個人戦なら従来どおり ON にできる', async () => {
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05', kind: 'individual' })
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06', kind: 'individual' })

    await setConfirmedRosterOverride(group.id, true)

    expect(await readOverride(group.id)).toBe(true)
  })
})
