import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcrypt'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { authorizeCredentials } from '@/lib/credentials-authorize'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

async function seedWithPassword(
  name: string,
  plain: string,
  overrides: Parameters<typeof createUser>[0] = {},
) {
  const passwordHash = await bcrypt.hash(plain, 4) // low cost for speed in tests
  return createUser({ name, passwordHash, ...overrides })
}

describe('authorizeCredentials — Credentials provider predicate', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('正しいユーザー名+パスワードで成功する', async () => {
    const user = await seedWithPassword('alice', 'password123', {
      isInvited: true,
      mustChangePassword: false,
    })
    const result = await authorizeCredentials({
      username: 'alice',
      password: 'password123',
    })
    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      id: user.id,
      name: 'alice',
      role: 'member',
      mustChangePassword: false,
    })
  })

  it('mustChangePassword=true が結果に反映される', async () => {
    await seedWithPassword('alice', 'password123', {
      isInvited: true,
      mustChangePassword: true,
    })
    const result = await authorizeCredentials({
      username: 'alice',
      password: 'password123',
    })
    expect(result?.mustChangePassword).toBe(true)
  })

  it('誤ったパスワードで null を返す', async () => {
    await seedWithPassword('alice', 'password123', { isInvited: true })
    const result = await authorizeCredentials({
      username: 'alice',
      password: 'wrong',
    })
    expect(result).toBeNull()
  })

  it('isInvited=false のユーザーは null を返す', async () => {
    await seedWithPassword('alice', 'password123', { isInvited: false })
    const result = await authorizeCredentials({
      username: 'alice',
      password: 'password123',
    })
    expect(result).toBeNull()
  })

  it('passwordHash=NULL のユーザーは null を返す', async () => {
    await createUser({ name: 'bob', passwordHash: null, isInvited: true })
    const result = await authorizeCredentials({
      username: 'bob',
      password: 'anything',
    })
    expect(result).toBeNull()
  })

  it('存在しないユーザー名で null を返す', async () => {
    const result = await authorizeCredentials({
      username: 'ghost',
      password: 'x',
    })
    expect(result).toBeNull()
  })

  it('空のユーザー名でバリデーション失敗 → null', async () => {
    const result = await authorizeCredentials({ username: '', password: 'x' })
    expect(result).toBeNull()
  })

  it('credentials が null でも null を返す', async () => {
    const result = await authorizeCredentials(null)
    expect(result).toBeNull()
  })

  it('deactivatedAt がセットされたユーザーは null を返す', async () => {
    await seedWithPassword('alice', 'password123', {
      isInvited: true,
      mustChangePassword: false,
      deactivatedAt: new Date(),
    })
    const result = await authorizeCredentials({
      username: 'alice',
      password: 'password123',
    })
    expect(result).toBeNull()
  })

  it('認証成功時に lineUserId が結果に含まれる', async () => {
    await seedWithPassword('alice', 'password123', {
      isInvited: true,
      mustChangePassword: false,
      lineUserId: 'Uabc123',
    })
    const result = await authorizeCredentials({
      username: 'alice',
      password: 'password123',
    })
    expect(result?.lineUserId).toBe('Uabc123')
  })
})
