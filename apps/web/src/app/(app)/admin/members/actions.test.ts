import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { registrationInvites, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const {
  createMember,
  createRegistrationInvite,
  revokeRegistrationInvite,
  listActiveRegistrationInvites,
} = await import('./actions')

// Shared pool: close once after every describe in this file finishes (the
// individual describes only truncate between tests).
afterAll(async () => {
  await closeTestDb()
})

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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

describe('createRegistrationInvite', () => {
  const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

  beforeEach(async () => {
    await truncateAll()
    // Pin the origin so the action returns a deterministic URL without needing
    // a request context (resolveRegistrationBaseUrl checks env before headers()).
    process.env.PUBLIC_BASE_URL = 'https://test.example.com'
  })
  afterAll(() => {
    if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
  })

  it('管理者が発行すると行が作成され、完全URLと失効日時を返す', async () => {
    const admin = await createAdmin({ name: 'inv-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const before = Date.now()
    const result = await createRegistrationInvite('7d')
    const after = Date.now()

    expect(result.error).toBeUndefined()
    expect(result.url).toMatch(/^https:\/\/test\.example\.com\/register\/[A-Za-z0-9_-]{43}$/)
    expect(result.expiresAt).toBeDefined()

    const rows = await testDb.select().from(registrationInvites)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.createdBy).toBe(admin.id)
    expect(row?.revokedAt).toBeNull()
    // The returned URL ends with the stored token.
    expect(result.url?.endsWith(row!.token)).toBe(true)
    // Expiry ≈ now + 7d.
    const exp = row!.expiresAt.getTime()
    expect(exp).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 1000)
    expect(exp).toBeLessThanOrEqual(after + SEVEN_DAYS_MS + 1000)
  })

  it('vice_admin も発行できる', async () => {
    const vice = await createViceAdmin({ name: 'inv-vice-1' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    const result = await createRegistrationInvite('1d')
    expect(result.url).toBeDefined()
    expect(await testDb.select().from(registrationInvites)).toHaveLength(1)
  })

  it('一般会員が呼ぶと拒否され、行は作成されない', async () => {
    const member = await createUser({ name: 'inv-member-1', role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(createRegistrationInvite('7d')).rejects.toThrow(/Unauthorized/)
    expect(await testDb.select().from(registrationInvites)).toHaveLength(0)
  })

  it('未認証なら拒否される', async () => {
    await setAuthSession(null)
    await expect(createRegistrationInvite('7d')).rejects.toThrow(/Unauthorized/)
    expect(await testDb.select().from(registrationInvites)).toHaveLength(0)
  })

  it('不正なプリセットはエラー、行は作成されない', async () => {
    const admin = await createAdmin({ name: 'inv-admin-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await createRegistrationInvite('999d')
    expect(result.error).toBeDefined()
    expect(result.url).toBeUndefined()
    expect(await testDb.select().from(registrationInvites)).toHaveLength(0)
  })
})

describe('revokeRegistrationInvite', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('管理者が無効化すると revoked_at がセットされる', async () => {
    const admin = await createAdmin({ name: 'rev-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const [row] = await testDb
      .insert(registrationInvites)
      .values({
        token: 'token-to-revoke',
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
        createdBy: admin.id,
      })
      .returning()

    const before = Date.now()
    const result = await revokeRegistrationInvite(row!.id)
    expect(result.success).toBe(true)

    const [after] = await testDb
      .select()
      .from(registrationInvites)
      .where(eq(registrationInvites.id, row!.id))
    expect(after?.revokedAt).toBeInstanceOf(Date)
    expect(after!.revokedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('一般会員が呼ぶと拒否され、revoked_at は変わらない', async () => {
    const admin = await createAdmin({ name: 'rev-admin-2' })
    const [row] = await testDb
      .insert(registrationInvites)
      .values({
        token: 'token-stays',
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
        createdBy: admin.id,
      })
      .returning()
    const member = await createUser({ name: 'rev-member-1', role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(revokeRegistrationInvite(row!.id)).rejects.toThrow(/Unauthorized/)
    const [unchanged] = await testDb
      .select()
      .from(registrationInvites)
      .where(eq(registrationInvites.id, row!.id))
    expect(unchanged?.revokedAt).toBeNull()
  })

  it('二重無効化は最初の revoked_at を保持する（冪等）', async () => {
    const admin = await createAdmin({ name: 'rev-admin-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const firstRevoked = new Date('2026-06-01T00:00:00Z')
    const [row] = await testDb
      .insert(registrationInvites)
      .values({
        token: 'token-already-revoked',
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
        createdBy: admin.id,
        revokedAt: firstRevoked,
      })
      .returning()

    const result = await revokeRegistrationInvite(row!.id)
    expect(result.success).toBe(true)
    const [after] = await testDb
      .select()
      .from(registrationInvites)
      .where(eq(registrationInvites.id, row!.id))
    expect(after?.revokedAt?.toISOString()).toBe(firstRevoked.toISOString())
  })
})

describe('listActiveRegistrationInvites', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('未失効・未無効化のリンクのみを新しい順で返す', async () => {
    const admin = await createAdmin({ name: 'list-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const now = new Date('2026-06-26T00:00:00Z')
    const future = new Date(now.getTime() + 86_400_000)
    const past = new Date(now.getTime() - 86_400_000)

    await testDb.insert(registrationInvites).values([
      {
        token: 'active-old',
        expiresAt: future,
        createdBy: admin.id,
        createdAt: new Date('2026-06-20T00:00:00Z'),
      },
      {
        token: 'active-new',
        expiresAt: future,
        createdBy: admin.id,
        createdAt: new Date('2026-06-25T00:00:00Z'),
      },
      {
        token: 'expired',
        expiresAt: past,
        createdBy: admin.id,
        createdAt: new Date('2026-06-24T00:00:00Z'),
      },
      {
        token: 'revoked',
        expiresAt: future,
        createdBy: admin.id,
        createdAt: new Date('2026-06-24T00:00:00Z'),
        revokedAt: now,
      },
    ])

    const list = await listActiveRegistrationInvites(now)
    expect(list.map((l) => l.token)).toEqual(['active-new', 'active-old'])
  })

  it('一般会員が呼ぶと拒否される', async () => {
    const member = await createUser({ name: 'list-member-1', role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(listActiveRegistrationInvites()).rejects.toThrow(/Unauthorized/)
  })
})
