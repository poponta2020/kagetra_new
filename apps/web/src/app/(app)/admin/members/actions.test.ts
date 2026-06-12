import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { createMember } = await import('./actions')

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

async function findByName(name: string) {
  return testDb.select().from(users).where(eq(users.name, name))
}

describe('createMember', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('管理者が名前のみで作成できる（grade=null, role=member, isInvited=true, 未紐付け）', async () => {
    const admin = await createAdmin({ name: 'admin-create-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createMember({}, formOf({ name: '新井太郎', grade: '' }))
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)

    const rows = await findByName('新井太郎')
    expect(rows).toHaveLength(1)
    const created = rows[0]
    expect(created?.grade).toBeNull()
    expect(created?.role).toBe('member')
    expect(created?.isInvited).toBe(true)
    expect(created?.invitedAt).toBeInstanceOf(Date)
    expect(created?.lineUserId).toBeNull()
    expect(created?.deactivatedAt).toBeNull()
  })

  it('名前+級で作成できる', async () => {
    const admin = await createAdmin({ name: 'admin-create-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createMember({}, formOf({ name: '札幌次郎', grade: 'C' }))
    expect(result.success).toBe(true)

    const rows = await findByName('札幌次郎')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.grade).toBe('C')
  })

  it('名前の前後空白は trim されて保存される', async () => {
    const admin = await createAdmin({ name: 'admin-create-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createMember({}, formOf({ name: '  山田 花子  ', grade: '' }))
    expect(result.success).toBe(true)

    const rows = await findByName('山田 花子')
    expect(rows).toHaveLength(1)
  })

  it('vice_admin も作成できる', async () => {
    const vice = await createViceAdmin({ name: 'vice-create-1' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    const result = await createMember({}, formOf({ name: '副管理者作成', grade: 'A' }))
    expect(result.success).toBe(true)
    expect(await findByName('副管理者作成')).toHaveLength(1)
  })

  it('一般会員が呼ぶと拒否される (throws Unauthorized)、行は作成されない', async () => {
    const member = await createUser({ name: 'member-create-1', role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(
      createMember({}, formOf({ name: '不正作成', grade: '' })),
    ).rejects.toThrow(/Unauthorized/)
    expect(await findByName('不正作成')).toHaveLength(0)
  })

  it('未認証なら拒否される', async () => {
    await setAuthSession(null)
    await expect(
      createMember({}, formOf({ name: '未認証作成', grade: '' })),
    ).rejects.toThrow(/Unauthorized/)
    expect(await findByName('未認証作成')).toHaveLength(0)
  })

  it('空白のみの名前は入力エラー、行は作成されない', async () => {
    const admin = await createAdmin({ name: 'admin-create-4' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createMember({}, formOf({ name: '   ', grade: '' }))
    expect(result.error).toBeDefined()
    expect(result.success).toBeUndefined()

    // admin 以外の行が増えていないこと
    const all = await testDb.select().from(users)
    expect(all).toHaveLength(1)
  })

  it('name フィールド自体が無い場合も入力エラー', async () => {
    const admin = await createAdmin({ name: 'admin-create-5' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createMember({}, formOf({ grade: 'B' }))
    expect(result.error).toBeDefined()
  })

  it('51文字の名前は入力エラー、50文字は成功する', async () => {
    const admin = await createAdmin({ name: 'admin-create-6' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const over = await createMember({}, formOf({ name: 'あ'.repeat(51), grade: '' }))
    expect(over.error).toBeDefined()

    const exact = await createMember({}, formOf({ name: 'い'.repeat(50), grade: '' }))
    expect(exact.success).toBe(true)
    expect(await findByName('い'.repeat(50))).toHaveLength(1)
  })

  it('不正な grade (Z) は入力エラー、行は作成されない', async () => {
    const admin = await createAdmin({ name: 'admin-create-7' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createMember({}, formOf({ name: '級不正', grade: 'Z' }))
    expect(result.error).toBeDefined()
    expect(await findByName('級不正')).toHaveLength(0)
  })

  it('同名の会員が既に存在すると重複エラー（退会済みも含む）', async () => {
    const admin = await createAdmin({ name: 'admin-create-8' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    // 退会済みの同名会員でも UNIQUE 制約に当たることを確認する
    await createUser({ name: '重複会員', deactivatedAt: new Date() })

    const result = await createMember({}, formOf({ name: '重複会員', grade: '' }))
    expect(result.error).toBe('同名の会員が既に存在します（退会済み会員を含む）')
    expect(result.success).toBeUndefined()

    // 行は増えていない
    expect(await findByName('重複会員')).toHaveLength(1)
  })
})
