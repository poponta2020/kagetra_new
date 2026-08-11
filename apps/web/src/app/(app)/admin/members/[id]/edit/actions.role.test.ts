import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { updateMemberRole, unlinkLine } = await import('./actions')
const { revalidatePath } = await import('next/cache')

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

async function roleOf(userId: string) {
  const row = await testDb.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  })
  return row?.role
}

/** LINE 紐付け済み = 昇格の前提条件を満たす行。 */
function linked(overrides: Record<string, unknown> = {}) {
  return { lineUserId: `U-${crypto.randomUUID()}`, ...overrides }
}

describe('updateMemberRole', () => {
  beforeEach(async () => {
    await truncateAll()
    vi.mocked(revalidatePath).mockClear()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('認可', () => {
    it('副管理者は拒否され、対象のロールが変わらない（AC-2）', async () => {
      const vice = await createViceAdmin({ name: 'vice-role-1', ...linked() })
      const target = await createUser({ name: 'target-role-1', ...linked() })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })

      await expect(
        updateMemberRole({}, formOf({ userId: target.id, role: 'admin' })),
      ).rejects.toThrow()
      expect(await roleOf(target.id)).toBe('member')
    })

    it('一般会員は拒否され、対象のロールが変わらない（AC-3）', async () => {
      const member = await createUser({ name: 'member-role-1', ...linked() })
      const target = await createUser({ name: 'target-role-2', ...linked() })
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(
        updateMemberRole({}, formOf({ userId: target.id, role: 'vice_admin' })),
      ).rejects.toThrow()
      expect(await roleOf(target.id)).toBe('member')
    })

    it('未ログインは拒否される（AC-3 の境界）', async () => {
      const target = await createUser({ name: 'target-role-3', ...linked() })
      await setAuthSession(null)

      await expect(
        updateMemberRole({}, formOf({ userId: target.id, role: 'vice_admin' })),
      ).rejects.toThrow()
      expect(await roleOf(target.id)).toBe('member')
    })

    it('表示ロールを一般会員にプレビュー中の管理者は拒否される（AC-4）', async () => {
      const admin = await createAdmin({ name: 'admin-preview-1', ...linked() })
      const target = await createUser({ name: 'target-role-4', ...linked() })
      // 実効ロール = member / 本物のロール = admin（role-preview-switch 中）。
      await setAuthSession({ id: admin.id, role: 'member', realRole: 'admin' })

      await expect(
        updateMemberRole({}, formOf({ userId: target.id, role: 'vice_admin' })),
      ).rejects.toThrow()
      expect(await roleOf(target.id)).toBe('member')
    })
  })

  describe('成功系', () => {
    it('一般会員を副管理者にできる（AC-5）', async () => {
      const admin = await createAdmin({ name: 'admin-ok-1', ...linked() })
      const target = await createUser({ name: 'target-ok-1', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'vice_admin' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('vice_admin')
    })

    it('副管理者を一般会員に降格できる（AC-6）', async () => {
      const admin = await createAdmin({ name: 'admin-ok-2', ...linked() })
      const target = await createViceAdmin({ name: 'target-ok-2', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'member' }),
      )
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('member')
    })

    it('紐付け済みの会員を管理者にでき、有効な管理者が 2 人になる（AC-7）', async () => {
      const admin = await createAdmin({ name: 'admin-ok-3', ...linked() })
      const target = await createUser({ name: 'target-ok-3', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'admin' }),
      )
      expect(result.success).toBe(true)

      const admins = await testDb.query.users.findMany({
        where: eq(users.role, 'admin'),
        columns: { id: true },
      })
      expect(admins).toHaveLength(2)
    })

    it('成功時に一覧と編集ページの両方が再検証される（AC-16）', async () => {
      const admin = await createAdmin({ name: 'admin-ok-4', ...linked() })
      const target = await createUser({ name: 'target-ok-4', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await updateMemberRole({}, formOf({ userId: target.id, role: 'vice_admin' }))

      expect(revalidatePath).toHaveBeenCalledWith('/admin/members')
      expect(revalidatePath).toHaveBeenCalledWith(
        `/admin/members/${target.id}/edit`,
      )
    })
  })

  describe('拒否系', () => {
    it('LINE 未紐付けの会員は管理者にできない（AC-8）', async () => {
      const admin = await createAdmin({ name: 'admin-ng-1', ...linked() })
      const target = await createUser({ name: 'target-ng-1', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'admin' }),
      )
      expect(result.error).toContain('LINE 紐付け前')
      expect(await roleOf(target.id)).toBe('member')
    })

    it('LINE 未紐付けの会員は副管理者にもできない（AC-8）', async () => {
      const admin = await createAdmin({ name: 'admin-ng-2', ...linked() })
      const target = await createUser({ name: 'target-ng-2', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'vice_admin' }),
      )
      expect(result.error).toContain('LINE 紐付け前')
      expect(await roleOf(target.id)).toBe('member')
    })

    it('退会済みの会員は副管理者にできない（AC-10）', async () => {
      const admin = await createAdmin({ name: 'admin-ng-3', ...linked() })
      const target = await createUser({
        name: 'target-ng-3',
        ...linked({ deactivatedAt: new Date() }),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'vice_admin' }),
      )
      expect(result.error).toContain('退会済み')
      expect(await roleOf(target.id)).toBe('member')
    })

    it('退会済みの副管理者は一般会員に降格できる（AC-11）', async () => {
      const admin = await createAdmin({ name: 'admin-ng-4', ...linked() })
      const target = await createViceAdmin({
        name: 'target-ng-4',
        ...linked({ deactivatedAt: new Date() }),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'member' }),
      )
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('member')
    })

    it('自分自身のロールは変更できない（AC-12）', async () => {
      const admin = await createAdmin({ name: 'admin-self-1', ...linked() })
      // 他に管理者が居ても、自分の行は対象外。
      await createAdmin({ name: 'admin-self-2', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: admin.id, role: 'member' }),
      )
      expect(result.error).toBe('ご自身のロールは変更できません')
      expect(await roleOf(admin.id)).toBe('admin')
    })

    it('有効な管理者が自分 1 人だけなら降格できない（退会済み管理者は数に入れない）（AC-13）', async () => {
      const admin = await createAdmin({ name: 'admin-last-1', ...linked() })
      // 退会済みの管理者はログインできないので「有効な管理者」ではない。
      await createAdmin({
        name: 'admin-last-2',
        ...linked({ deactivatedAt: new Date() }),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: admin.id, role: 'vice_admin' }),
      )
      expect(result.error).toBeDefined()
      expect(await roleOf(admin.id)).toBe('admin')
    })

    it('存在しない userId は拒否され、例外にならない（AC-14）', async () => {
      const admin = await createAdmin({ name: 'admin-bad-1', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: crypto.randomUUID(), role: 'vice_admin' }),
      )
      expect(result.error).toBe('対象の会員が見つかりません')
    })

    it('enum 外のロール値は拒否される（AC-14）', async () => {
      const admin = await createAdmin({ name: 'admin-bad-2', ...linked() })
      const target = await createUser({ name: 'target-bad-2', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'superuser' }),
      )
      expect(result.error).toBe('入力が不正です')
      expect(await roleOf(target.id)).toBe('member')
    })

    it('userId が空でも拒否される（AC-14）', async () => {
      const admin = await createAdmin({ name: 'admin-bad-3', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole({}, formOf({ userId: '', role: 'member' }))
      expect(result.error).toBe('入力が不正です')
    })
  })

  describe('昇格後の LINE 解除（未紐付けの権限持ち行を作らせない）', () => {
    // 昇格時の紐付けチェックだけでは塞げない裏口。昇格 → unlinkLine の順で
    // 実行すると「未紐付けの管理者行」ができ、/self-identify（未紐付け ∧
    // 招待済みを role 無視で候補化する）経由で第三者に名乗られる。
    async function unlinkOf(userId: string) {
      const fd = new FormData()
      fd.set('userId', userId)
      return unlinkLine(fd)
    }

    it('昇格させた副管理者の LINE 紐付けは解除できない', async () => {
      const admin = await createAdmin({ name: 'admin-unlink-role-1', ...linked() })
      const target = await createUser({ name: 'target-unlink-role-1', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await updateMemberRole({}, formOf({ userId: target.id, role: 'vice_admin' }))
      await expect(unlinkOf(target.id)).rejects.toThrow(/privileged_role/)

      const after = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
        columns: { role: true, lineUserId: true },
      })
      expect(after?.role).toBe('vice_admin')
      expect(after?.lineUserId).not.toBeNull()
    })

    it('管理者の LINE 紐付けも解除できない', async () => {
      const admin = await createAdmin({ name: 'admin-unlink-role-2', ...linked() })
      const target = await createAdmin({ name: 'target-unlink-role-2', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(unlinkOf(target.id)).rejects.toThrow(/privileged_role/)

      const after = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
        columns: { lineUserId: true },
      })
      expect(after?.lineUserId).not.toBeNull()
    })

    it('一般会員に降格させれば解除できる（正規の手順）', async () => {
      const admin = await createAdmin({ name: 'admin-unlink-role-3', ...linked() })
      const target = await createViceAdmin({
        name: 'target-unlink-role-3',
        ...linked(),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await updateMemberRole({}, formOf({ userId: target.id, role: 'member' }))
      await expect(unlinkOf(target.id)).resolves.toBeUndefined()

      const after = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
        columns: { role: true, lineUserId: true },
      })
      expect(after?.role).toBe('member')
      expect(after?.lineUserId).toBeNull()
    })

    it('存在しない userId の解除は従来どおり無害（既存契約の回帰）', async () => {
      const admin = await createAdmin({ name: 'admin-unlink-role-4', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(unlinkOf(crypto.randomUUID())).resolves.toBeUndefined()
    })
  })

  describe('冪等', () => {
    it('現在と同じロールの保存はエラーにならない（AC-15）', async () => {
      const admin = await createAdmin({ name: 'admin-same-1', ...linked() })
      const target = await createViceAdmin({ name: 'target-same-1', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'vice_admin' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('vice_admin')
    })

    it('未紐付けの会員に member を保存してもエラーにならない（AC-9）', async () => {
      const admin = await createAdmin({ name: 'admin-same-2', ...linked() })
      const target = await createUser({ name: 'target-same-2', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'member' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('member')
    })

    it('未紐付けの副管理者を member へ降格できる（昇格制限は降格に及ばない）（AC-9）', async () => {
      const admin = await createAdmin({ name: 'admin-same-3', ...linked() })
      const target = await createViceAdmin({
        name: 'target-same-3',
        lineUserId: null,
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'member' }),
      )
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('member')
    })
  })

  describe('guest-role: 4択化（AC-25 / AC-26 / AC-37）', () => {
    it('一般会員をゲストにできる（AC-25）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-1', ...linked() })
      const target = await createUser({ name: 'target-guest-1', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'guest' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('guest')
    })

    it('ゲストを一般会員にできる（AC-25）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-2', ...linked() })
      const target = await createGuest({ name: 'target-guest-2', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'member' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('member')
    })

    it('LINE 未紐付けの会員でもゲストへの変更は拒否されない（AC-26）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-3', ...linked() })
      const target = await createUser({ name: 'target-guest-3', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'guest' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('guest')
    })

    it('退会済みの会員でもゲストへの変更は拒否されない（AC-26）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-4', ...linked() })
      const target = await createUser({
        name: 'target-guest-4',
        ...linked({ deactivatedAt: new Date() }),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'guest' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('guest')
    })

    it('LINE 紐付け済み・有効なゲストは admin にできる（昇格制限は満たせば通る）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-5', ...linked() })
      const target = await createGuest({ name: 'target-guest-5', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'admin' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      expect(await roleOf(target.id)).toBe('admin')
    })

    it('LINE 未紐付けのゲストは admin にできない（昇格制限は guest → admin にも効く）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-6', ...linked() })
      const target = await createGuest({ name: 'target-guest-6', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberRole(
        {},
        formOf({ userId: target.id, role: 'admin' }),
      )
      expect(result.error).toContain('LINE 紐付け前')
      expect(await roleOf(target.id)).toBe('guest')
    })

    it('ゲストの LINE 紐付け解除は拒否される（AC-37）', async () => {
      const admin = await createAdmin({ name: 'admin-guest-7', ...linked() })
      const target = await createGuest({ name: 'target-guest-7', ...linked() })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const fd = new FormData()
      fd.set('userId', target.id)
      await expect(unlinkLine(fd)).rejects.toThrow(/privileged_role/)

      const after = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
        columns: { role: true, lineUserId: true },
      })
      expect(after?.role).toBe('guest')
      expect(after?.lineUserId).not.toBeNull()
    })
  })
})
