import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { bulkUpdateCircleMembers } = await import('./actions')

function formOf(data: Record<string, string | string[]>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      for (const item of v) fd.append(k, item)
    } else {
      fd.append(k, v)
    }
  }
  return fd
}

async function circleOf(userId: string) {
  return testDb.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isCircleMember: true, facultyKind: true, faculty: true, schoolYear: true },
  })
}

describe('bulkUpdateCircleMembers（S3 一括編集・AC-6）', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('管理者が複数人のサークル所属・学部区分・学部等名・学年を1回で更新できる', async () => {
    const admin = await createAdmin({ name: 'bulk-admin-1' })
    const a = await createUser({ name: 'bulk-target-a' })
    const b = await createUser({ name: 'bulk-target-b' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await bulkUpdateCircleMembers(
      {},
      formOf({
        userIds: [a.id, b.id],
        [`isCircleMember_${a.id}`]: 'on',
        [`facultyKind_${a.id}`]: 'undergraduate',
        [`faculty_${a.id}`]: '工学部',
        [`schoolYear_${a.id}`]: '3年',
        [`isCircleMember_${b.id}`]: 'on',
        [`facultyKind_${b.id}`]: 'graduate',
        [`faculty_${b.id}`]: '情報科学院',
        [`schoolYear_${b.id}`]: '修士1年',
      }),
    )
    expect(result).toEqual({ success: true, updatedCount: 2 })

    expect(await circleOf(a.id)).toEqual({
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '工学部',
      schoolYear: '3年',
    })
    expect(await circleOf(b.id)).toEqual({
      isCircleMember: true,
      facultyKind: 'graduate',
      faculty: '情報科学院',
      schoolYear: '修士1年',
    })
  })

  it('副管理者も更新できる', async () => {
    const vice = await createViceAdmin({ name: 'bulk-vice-1' })
    const target = await createUser({ name: 'bulk-target-vice' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    const result = await bulkUpdateCircleMembers(
      {},
      formOf({
        userIds: [target.id],
        [`isCircleMember_${target.id}`]: 'on',
        [`facultyKind_${target.id}`]: 'undergraduate',
        [`faculty_${target.id}`]: '法学部',
        [`schoolYear_${target.id}`]: '2年',
      }),
    )
    expect(result.success).toBe(true)
    expect((await circleOf(target.id))?.faculty).toBe('法学部')
  })

  it('一般会員は拒否され、DBは変更されない', async () => {
    const member = await createUser({ name: 'bulk-member-1', role: 'member' })
    const target = await createUser({ name: 'bulk-target-rejected' })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(
      bulkUpdateCircleMembers(
        {},
        formOf({
          userIds: [target.id],
          [`isCircleMember_${target.id}`]: 'on',
          [`facultyKind_${target.id}`]: 'undergraduate',
          [`faculty_${target.id}`]: '工学部',
          [`schoolYear_${target.id}`]: '1年',
        }),
      ),
    ).rejects.toThrow(/Unauthorized/)

    expect((await circleOf(target.id))?.isCircleMember).toBe(false)
  })

  it('未認証は拒否される', async () => {
    await setAuthSession(null)
    const target = await createUser({ name: 'bulk-target-unauth' })

    await expect(
      bulkUpdateCircleMembers({}, formOf({ userIds: [target.id] })),
    ).rejects.toThrow(/Unauthorized/)
  })

  it('OFF の行は既存の学部属性を保持する（消さない）', async () => {
    const admin = await createAdmin({ name: 'bulk-admin-2' })
    const target = await createUser({
      name: 'bulk-target-off',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '4年',
    })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await bulkUpdateCircleMembers(
      {},
      formOf({ userIds: [target.id] }),
    )
    expect(result.success).toBe(true)

    expect(await circleOf(target.id)).toEqual({
      isCircleMember: false,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '4年',
    })
  })

  it('ON なのに学部等名が空だとエラーになり、対象は誰も更新されない', async () => {
    const admin = await createAdmin({ name: 'bulk-admin-3' })
    const a = await createUser({ name: 'bulk-target-c' })
    const b = await createUser({ name: 'bulk-target-d' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await bulkUpdateCircleMembers(
      {},
      formOf({
        userIds: [a.id, b.id],
        [`isCircleMember_${a.id}`]: 'on',
        [`facultyKind_${a.id}`]: 'undergraduate',
        [`faculty_${a.id}`]: '工学部',
        [`schoolYear_${a.id}`]: '3年',
        [`isCircleMember_${b.id}`]: 'on',
        [`facultyKind_${b.id}`]: 'undergraduate',
        // faculty_b が欠けている。
        [`schoolYear_${b.id}`]: '3年',
      }),
    )
    expect(result.error).toContain('学部等名')

    // どちらも更新されていない（バリデーションは DB 書き込み前に全行を検査する）。
    expect((await circleOf(a.id))?.isCircleMember).toBe(false)
    expect((await circleOf(b.id))?.isCircleMember).toBe(false)
  })

  it('区分と整合しない学年は拒否される', async () => {
    const admin = await createAdmin({ name: 'bulk-admin-4' })
    const target = await createUser({ name: 'bulk-target-year' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await bulkUpdateCircleMembers(
      {},
      formOf({
        userIds: [target.id],
        [`isCircleMember_${target.id}`]: 'on',
        [`facultyKind_${target.id}`]: 'undergraduate',
        [`faculty_${target.id}`]: '工学部',
        [`schoolYear_${target.id}`]: '修士1年',
      }),
    )
    expect(result.error).toContain('学年')
  })

  it('候補外の学部等名も自由入力として保存できる（AC-4）', async () => {
    const admin = await createAdmin({ name: 'bulk-admin-5' })
    const target = await createUser({ name: 'bulk-target-free' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await bulkUpdateCircleMembers(
      {},
      formOf({
        userIds: [target.id],
        [`isCircleMember_${target.id}`]: 'on',
        [`facultyKind_${target.id}`]: 'undergraduate',
        [`faculty_${target.id}`]: '候補外学部',
        [`schoolYear_${target.id}`]: '1年',
      }),
    )
    expect(result.success).toBe(true)
    expect((await circleOf(target.id))?.faculty).toBe('候補外学部')
  })

  it('対象 userIds が空だとエラー', async () => {
    const admin = await createAdmin({ name: 'bulk-admin-6' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await bulkUpdateCircleMembers({}, formOf({}))
    expect(result.error).toBeDefined()
  })
})
