import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { eventAttendances, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEvent,
  createEventAttendance,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const {
  updateMemberProfile,
  toggleMemberDeactivation,
  unlinkLine,
  updateMemberName,
  deleteMember,
} = await import('./actions')

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

  describe('updateMemberName', () => {
    it('未紐付け会員の名前を変更できる（trim 済みで保存）', async () => {
      const admin = await createAdmin({ name: 'admin-rename-1' })
      const target = await createUser({ name: '旧名前', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: target.id, name: '  新名前  ' }),
      )
      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)

      const updated = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(updated?.name).toBe('新名前')
    })

    it('LINE 紐付け済み会員は変更できずエラー、DB 不変', async () => {
      const admin = await createAdmin({ name: 'admin-rename-2' })
      const target = await createUser({
        name: '紐付け済み会員',
        lineUserId: 'Ulinked-rename',
        lineLinkedAt: new Date(),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: target.id, name: '変更後' }),
      )
      expect(result.error).toBe('LINE 紐付け済みのため変更できません')
      expect(result.success).toBeUndefined()

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.name).toBe('紐付け済み会員')
    })

    it('存在しない userId は 0 行更新でエラーになる', async () => {
      const admin = await createAdmin({ name: 'admin-rename-3' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: 'no-such-id', name: '誰でもない' }),
      )
      expect(result.error).toBeDefined()
    })

    it('vice_admin は未紐付けの admin 行をリネームできない（DB 不変）', async () => {
      const vice = await createViceAdmin({ name: 'vice-rename-rbac' })
      const targetAdmin = await createAdmin({
        name: 'リネームされない管理者',
        lineUserId: null,
      })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: targetAdmin.id, name: '改ざん名' }),
      )
      expect(result.error).toBe('LINE 紐付け済みのため変更できません')

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, targetAdmin.id),
      })
      expect(unchanged?.name).toBe('リネームされない管理者')
    })

    it('admin でも未紐付けの vice_admin 行はリネームできない（member 限定）', async () => {
      const admin = await createAdmin({ name: 'admin-rename-rbac' })
      const targetVice = await createViceAdmin({
        name: 'リネームされない副管理者',
        lineUserId: null,
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: targetVice.id, name: '改ざん名2' }),
      )
      expect(result.error).toBe('LINE 紐付け済みのため変更できません')

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, targetVice.id),
      })
      expect(unchanged?.name).toBe('リネームされない副管理者')
    })

    it('別会員と同名に変更すると重複エラー、DB 不変', async () => {
      const admin = await createAdmin({ name: 'admin-rename-4' })
      await createUser({ name: '既存会員' })
      const target = await createUser({ name: '変更対象', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: target.id, name: '既存会員' }),
      )
      expect(result.error).toBe('同名の会員が既に存在します（退会済み会員を含む）')

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.name).toBe('変更対象')
    })

    it('空白のみの名前は入力エラー', async () => {
      const admin = await createAdmin({ name: 'admin-rename-5' })
      const target = await createUser({ name: '空白対象', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: target.id, name: '   ' }),
      )
      expect(result.error).toBeDefined()

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.name).toBe('空白対象')
    })

    it('51文字の名前は入力エラー', async () => {
      const admin = await createAdmin({ name: 'admin-rename-6' })
      const target = await createUser({ name: '長さ対象', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: target.id, name: 'あ'.repeat(51) }),
      )
      expect(result.error).toBeDefined()
    })

    it('vice_admin も変更できる', async () => {
      const vice = await createViceAdmin({ name: 'vice-rename-1' })
      const target = await createUser({ name: '副管理者対象', lineUserId: null })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })

      const result = await updateMemberName(
        {},
        formOf({ userId: target.id, name: '副管理者変更後' }),
      )
      expect(result.success).toBe(true)
    })

    it('一般会員は拒否される', async () => {
      const member = await createUser({ name: 'member-rename-1', role: 'member' })
      const target = await createUser({ name: '一般対象', lineUserId: null })
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(
        updateMemberName({}, formOf({ userId: target.id, name: '不正変更' })),
      ).rejects.toThrow(/Unauthorized/)

      const unchanged = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(unchanged?.name).toBe('一般対象')
    })

    it('未認証は拒否される', async () => {
      await setAuthSession(null)
      await expect(
        updateMemberName({}, formOf({ userId: 'x', name: '未認証変更' })),
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

  describe('deleteMember', () => {
    const BLOCKED =
      'この会員には関連データがあるか LINE 紐付け済みのため削除できません。退会切替を使ってください'

    it('参照ゼロ + 未紐付けの会員を hard delete できる', async () => {
      const admin = await createAdmin({ name: 'admin-del-1' })
      const target = await createUser({ name: '削除対象', lineUserId: null })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await deleteMember({}, formOf({ userId: target.id }))
      expect(result?.error).toBeUndefined()

      const gone = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(gone).toBeUndefined()

      const { redirect } = await import('next/navigation')
      expect(vi.mocked(redirect)).toHaveBeenCalledWith('/admin/members')
    })

    it('LINE 紐付け済みの会員は削除できない', async () => {
      const admin = await createAdmin({ name: 'admin-del-2' })
      const target = await createUser({
        name: '紐付け済み削除対象',
        lineUserId: 'Ulinked-del',
        lineLinkedAt: new Date(),
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await deleteMember({}, formOf({ userId: target.id }))
      expect(result?.error).toBe(BLOCKED)

      const still = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(still?.name).toBe('紐付け済み削除対象')
    })

    it('出欠履歴 (event_attendances) がある会員は削除できず、履歴も残る', async () => {
      const admin = await createAdmin({ name: 'admin-del-3' })
      const target = await createUser({ name: '出欠あり対象', lineUserId: null })
      const event = await createEvent({ title: '削除チェック大会' })
      const attendance = await createEventAttendance({
        eventId: event.id,
        userId: target.id,
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await deleteMember({}, formOf({ userId: target.id }))
      expect(result?.error).toBe(BLOCKED)

      // 会員行も出欠履歴も残っている（CASCADE で静かに消えていない）
      const still = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(still).toBeDefined()
      const attendanceStill = await testDb
        .select()
        .from(eventAttendances)
        .where(eq(eventAttendances.id, attendance.id))
      expect(attendanceStill).toHaveLength(1)
    })

    it('events.createdBy で参照されている会員は削除できない', async () => {
      const admin = await createAdmin({ name: 'admin-del-4' })
      const target = await createUser({ name: '作成者対象', lineUserId: null })
      await createEvent({ title: '作成者チェック大会', createdBy: target.id })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await deleteMember({}, formOf({ userId: target.id }))
      expect(result?.error).toBe(BLOCKED)

      const still = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(still).toBeDefined()
    })

    it('存在しない userId はエラー', async () => {
      const admin = await createAdmin({ name: 'admin-del-5' })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await deleteMember({}, formOf({ userId: 'no-such-id' }))
      expect(result?.error).toBe(BLOCKED)
    })

    it('vice_admin は未紐付け・参照ゼロでも admin 行を削除できない', async () => {
      const vice = await createViceAdmin({ name: 'vice-del-rbac' })
      const targetAdmin = await createAdmin({
        name: '削除されない管理者',
        lineUserId: null,
      })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })

      const result = await deleteMember({}, formOf({ userId: targetAdmin.id }))
      expect(result?.error).toBe(BLOCKED)

      const still = await testDb.query.users.findFirst({
        where: eq(users.id, targetAdmin.id),
      })
      expect(still?.role).toBe('admin')
    })

    it('admin でも vice_admin 行は削除できない（member 限定）', async () => {
      const admin = await createAdmin({ name: 'admin-del-rbac' })
      const targetVice = await createViceAdmin({
        name: '削除されない副管理者',
        lineUserId: null,
      })
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await deleteMember({}, formOf({ userId: targetVice.id }))
      expect(result?.error).toBe(BLOCKED)

      const still = await testDb.query.users.findFirst({
        where: eq(users.id, targetVice.id),
      })
      expect(still?.role).toBe('vice_admin')
    })

    it('vice_admin も削除できる', async () => {
      const vice = await createViceAdmin({ name: 'vice-del-1' })
      const target = await createUser({ name: '副管理者削除対象', lineUserId: null })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })

      const result = await deleteMember({}, formOf({ userId: target.id }))
      expect(result?.error).toBeUndefined()

      const gone = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(gone).toBeUndefined()
    })

    it('一般会員は拒否される、行は残る', async () => {
      const member = await createUser({ name: 'member-del-1', role: 'member' })
      const target = await createUser({ name: '一般削除対象', lineUserId: null })
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(
        deleteMember({}, formOf({ userId: target.id })),
      ).rejects.toThrow(/Unauthorized/)

      const still = await testDb.query.users.findFirst({
        where: eq(users.id, target.id),
      })
      expect(still).toBeDefined()
    })

    it('未認証は拒否される', async () => {
      await setAuthSession(null)
      await expect(
        deleteMember({}, formOf({ userId: 'x' })),
      ).rejects.toThrow(/Unauthorized/)
    })
  })
})
