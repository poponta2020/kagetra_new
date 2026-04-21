import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { updateMemberProfile, toggleMemberDeactivation, unlinkLine } = await import('./actions')

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

describe('Admin member profile edit actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('updateMemberProfile', () => {
    it('管理者が gender/affiliation/dan/zenNichikyo/grade を更新できる', async () => {
      const admin = await createAdmin({ name: 'admin-1' })
      const target = await createUser({ name: 'target-1', grade: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberProfile(
        {},
        formOf({
          userId: target.id,
          grade: 'B',
          gender: 'female',
          affiliation: '社会人',
          dan: '3',
          zenNichikyo: 'on',
        }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)

      const updated = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(updated?.grade).toBe('B')
      expect(updated?.gender).toBe('female')
      expect(updated?.affiliation).toBe('社会人')
      expect(updated?.dan).toBe(3)
      expect(updated?.zenNichikyo).toBe(true)
    })

    it('空欄の affiliation は null で保存される', async () => {
      const admin = await createAdmin({ name: 'admin-2' })
      const target = await createUser({ name: 'target-2', affiliation: '既存' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      await updateMemberProfile(
        {},
        formOf({
          userId: target.id,
          grade: '',
          gender: '',
          affiliation: '   ',
          dan: '',
          zenNichikyo: '',
        }),
      )

      const updated = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(updated?.affiliation).toBeNull()
      expect(updated?.grade).toBeNull()
      expect(updated?.gender).toBeNull()
      expect(updated?.dan).toBeNull()
      expect(updated?.zenNichikyo).toBe(false)
    })

    it('vice_admin も更新できる', async () => {
      const viceAdmin = await createUser({ name: 'vice-1', role: 'vice_admin' })
      const target = await createUser({ name: 'target-3' })
      await setAuthSession({ id: viceAdmin.id, role: 'vice_admin' })

      const result = await updateMemberProfile(
        {},
        formOf({
          userId: target.id,
          grade: 'A',
          gender: 'male',
          affiliation: '',
          dan: '5',
          zenNichikyo: '',
        }),
      )
      expect(result.success).toBe(true)
    })

    it('一般会員が呼ぶと拒否される (throws Unauthorized)', async () => {
      const member = await createUser({ name: 'member-1', role: 'member' })
      const target = await createUser({ name: 'target-4' })
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(
        updateMemberProfile(
          {},
          formOf({
            userId: target.id,
            grade: 'B',
            gender: '',
            affiliation: '',
            dan: '',
            zenNichikyo: '',
          }),
        ),
      ).rejects.toThrow(/Unauthorized/)
    })

    it('未認証なら拒否される', async () => {
      await setAuthSession(null)
      const target = await createUser({ name: 'target-5' })
      await expect(
        updateMemberProfile(
          {},
          formOf({
            userId: target.id,
            grade: 'B',
            gender: '',
            affiliation: '',
            dan: '',
            zenNichikyo: '',
          }),
        ),
      ).rejects.toThrow(/Unauthorized/)
    })

    it('dan が範囲外 (10) なら入力エラー', async () => {
      const admin = await createAdmin({ name: 'admin-3' })
      const target = await createUser({ name: 'target-6' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberProfile(
        {},
        formOf({
          userId: target.id,
          grade: '',
          gender: '',
          affiliation: '',
          dan: '10',
          zenNichikyo: '',
        }),
      )
      expect(result.error).toBeDefined()
    })

    it('dan に非整数 (3abc) を入れると入力エラー、DBは変更されない', async () => {
      const admin = await createAdmin({ name: 'admin-dan-nonint' })
      const target = await createUser({ name: 'target-dan-nonint', dan: 5 })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberProfile(
        {},
        formOf({
          userId: target.id,
          grade: '',
          gender: '',
          affiliation: '',
          dan: '3abc',
          zenNichikyo: '',
        }),
      )
      expect(result.error).toBeDefined()

      // DB は未変更（5 のまま）
      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.dan).toBe(5)
    })

    it('未知の grade (Z) は silent null にせず入力エラーとして拒否する', async () => {
      const admin = await createAdmin({ name: 'admin-grade-unk' })
      const target = await createUser({ name: 'target-grade-unk', grade: 'A' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberProfile(
        {},
        formOf({
          userId: target.id,
          grade: 'Z',
          gender: '',
          affiliation: '',
          dan: '',
          zenNichikyo: '',
        }),
      )
      expect(result.error).toBeDefined()

      // DB は未変更（A のまま）。旧実装は silent に null を入れていた。
      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.grade).toBe('A')
    })
  })

  describe('toggleMemberDeactivation', () => {
    it('deactivatedAt が NULL のユーザーを退会処理にすると now() がセットされる', async () => {
      const admin = await createAdmin({ name: 'admin-4' })
      const target = await createUser({ name: 'target-7', deactivatedAt: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      try {
        await toggleMemberDeactivation(formOf({ userId: target.id }))
      } catch {
        // redirect() throws NEXT_REDIRECT in tests; ignore.
      }

      const updated = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(updated?.deactivatedAt).toBeInstanceOf(Date)
    })

    it('退会処理済みのユーザーで再実行すると取り消される', async () => {
      const admin = await createAdmin({ name: 'admin-5' })
      const target = await createUser({
        name: 'target-8',
        deactivatedAt: new Date('2026-01-01T00:00:00Z'),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      try {
        await toggleMemberDeactivation(formOf({ userId: target.id }))
      } catch {
        // ignore redirect
      }

      const updated = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(updated?.deactivatedAt).toBeNull()
    })

    it('一般会員が呼ぶと拒否される', async () => {
      const member = await createUser({ name: 'member-2', role: 'member' })
      const target = await createUser({ name: 'target-9' })
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(
        toggleMemberDeactivation(formOf({ userId: target.id })),
      ).rejects.toThrow(/Unauthorized/)
    })
  })

  describe('unlinkLine', () => {
    it('admin が実行 → lineUserId/lineLinkedAt/lineLinkedMethod が NULL に戻る', async () => {
      const member = await createUser({
        name: 'linked',
        isInvited: true,
        lineUserId: 'Usome-id',
        lineLinkedAt: new Date(),
        lineLinkedMethod: 'self_identify',
      })
      const admin = await createAdmin({ name: 'admin-unlink-1' })
      await setAuthSession({
        id: admin.id,
        role: 'admin',
        lineUserId: admin.lineUserId ?? null,
      })

      const fd = new FormData()
      fd.set('userId', member.id)
      await unlinkLine(fd)

      const updated = await testDb.query.users.findFirst({
        where: eq(users.id, member.id),
      })
      expect(updated?.lineUserId).toBeNull()
      expect(updated?.lineLinkedAt).toBeNull()
      expect(updated?.lineLinkedMethod).toBeNull()
    })

    it('member が実行 → forbidden throw (DB 無変化)', async () => {
      const target = await createUser({
        name: 'target-unlink',
        lineUserId: 'Utgt',
        lineLinkedMethod: 'self_identify',
      })
      const caller = await createUser({ name: 'caller-unlink', role: 'member' })
      await setAuthSession({
        id: caller.id,
        role: 'member',
        lineUserId: caller.lineUserId ?? null,
      })

      const fd = new FormData()
      fd.set('userId', target.id)
      await expect(unlinkLine(fd)).rejects.toThrow(/forbidden/)

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.lineUserId).toBe('Utgt')
      expect(unchanged?.lineLinkedMethod).toBe('self_identify')
    })

    it('存在しない userId を指定 → 無害 (0 行 update で throw しない)', async () => {
      const admin = await createAdmin({ name: 'admin-unlink-missing' })
      await setAuthSession({
        id: admin.id,
        role: 'admin',
        lineUserId: admin.lineUserId ?? null,
      })

      const fd = new FormData()
      fd.set('userId', 'non-existent-id')
      await expect(unlinkLine(fd)).resolves.toBeUndefined()
    })
  })
})
