import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { updateMemberTreasurer } = await import('./actions')

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

async function treasurerOf(userId: string) {
  const row = await testDb.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isTreasurer: true },
  })
  return row?.isTreasurer
}

describe('会計フラグ（users.is_treasurer）', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('既定値は false（AC-1）', async () => {
    const member = await createUser({ name: 'treasurer-default' })
    expect(await treasurerOf(member.id)).toBe(false)
  })

  it('管理者はトグルを ON にできる（AC-2）', async () => {
    const admin = await createAdmin({ name: 'treasurer-admin' })
    const target = await createUser({ name: 'treasurer-target-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await updateMemberTreasurer(
      {},
      formOf({ userId: target.id, isTreasurer: 'on' }),
    )
    expect(result).toEqual({ success: true })
    expect(await treasurerOf(target.id)).toBe(true)
  })

  it('副管理者もトグルを更新できる（AC-2・§3.1.2 の既存ガードのまま）', async () => {
    const vice = await createViceAdmin({ name: 'treasurer-vice' })
    const target = await createUser({ name: 'treasurer-target-2' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    await updateMemberTreasurer({}, formOf({ userId: target.id, isTreasurer: 'on' }))
    expect(await treasurerOf(target.id)).toBe(true)
  })

  it('チェックを外すと OFF に戻る（AC-2）', async () => {
    const admin = await createAdmin({ name: 'treasurer-admin-2' })
    const target = await createUser({ name: 'treasurer-target-3', isTreasurer: true })
    await setAuthSession({ id: admin.id, role: 'admin' })

    // 未チェックのチェックボックスはキー自体が送られてこない。
    await updateMemberTreasurer({}, formOf({ userId: target.id }))
    expect(await treasurerOf(target.id)).toBe(false)
  })

  it('一般会員は拒否され、フラグが変わらない（AC-3）', async () => {
    const member = await createUser({ name: 'treasurer-member' })
    const target = await createUser({ name: 'treasurer-target-4' })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(
      updateMemberTreasurer({}, formOf({ userId: target.id, isTreasurer: 'on' })),
    ).rejects.toThrow()
    expect(await treasurerOf(target.id)).toBe(false)
  })

  it('未ログインは拒否される（AC-3 の境界）', async () => {
    const target = await createUser({ name: 'treasurer-target-5' })
    await setAuthSession(null)

    await expect(
      updateMemberTreasurer({}, formOf({ userId: target.id, isTreasurer: 'on' })),
    ).rejects.toThrow()
    expect(await treasurerOf(target.id)).toBe(false)
  })

  it('存在しない会員はエラーを返す', async () => {
    const admin = await createAdmin({ name: 'treasurer-admin-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await updateMemberTreasurer(
      {},
      formOf({ userId: 'no-such-user', isTreasurer: 'on' }),
    )
    expect(result.error).toBeTruthy()
  })
})
