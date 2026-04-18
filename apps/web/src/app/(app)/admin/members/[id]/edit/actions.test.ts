import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { updateMemberProfile, toggleMemberDeactivation } = await import('./actions')

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
})
