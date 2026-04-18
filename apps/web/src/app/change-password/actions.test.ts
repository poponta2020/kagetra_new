import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { changePasswordAction } = await import('./actions')
const { MIN_PASSWORD_LENGTH } = await import('./constants')

async function seedWithPassword(
  name: string,
  plain: string,
  overrides: Parameters<typeof createUser>[0] = {},
) {
  const passwordHash = await bcrypt.hash(plain, 4)
  return createUser({
    name,
    passwordHash,
    isInvited: true,
    mustChangePassword: true,
    ...overrides,
  })
}

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

describe('changePasswordAction', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('正しい現パスワードで成功し、mustChangePassword=false かつ新 hash に更新される', async () => {
    const user = await seedWithPassword('alice', 'pppppppp')
    await setAuthSession({ id: user.id, role: 'member', mustChangePassword: true })

    const result = await changePasswordAction(
      {},
      formOf({
        currentPassword: 'pppppppp',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      }),
    )
    expect(result?.error).toBeUndefined()

    const updated = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(updated?.mustChangePassword).toBe(false)
    expect(updated?.passwordHash).toBeTruthy()
    expect(updated?.passwordHash).not.toBe(user.passwordHash)
    // Verify the new password works
    const ok = await bcrypt.compare('newpassword123', updated!.passwordHash!)
    expect(ok).toBe(true)
  })

  it('新パスワードが現パスワードと同じ場合は失敗する（強制変更バイパス防止）', async () => {
    const user = await seedWithPassword('alice', 'pppppppp')
    await setAuthSession({ id: user.id, role: 'member', mustChangePassword: true })

    const result = await changePasswordAction(
      {},
      formOf({
        currentPassword: 'pppppppp',
        newPassword: 'pppppppp',
        confirmPassword: 'pppppppp',
      }),
    )
    expect(result.error).toMatch(/現在のパスワードと異なる/)

    // Ensure the DB was NOT mutated (mustChangePassword still true)
    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(unchanged?.mustChangePassword).toBe(true)
  })

  it('誤った現パスワードで失敗する', async () => {
    const user = await seedWithPassword('alice', 'pppppppp')
    await setAuthSession({ id: user.id, role: 'member', mustChangePassword: true })

    const result = await changePasswordAction(
      {},
      formOf({
        currentPassword: 'wrong',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      }),
    )
    expect(result.error).toMatch(/現在のパスワード/)
  })

  it('新パスワードが短すぎる場合は失敗する', async () => {
    const user = await seedWithPassword('alice', 'pppppppp')
    await setAuthSession({ id: user.id, role: 'member', mustChangePassword: true })

    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    const result = await changePasswordAction(
      {},
      formOf({
        currentPassword: 'pppppppp',
        newPassword: short,
        confirmPassword: short,
      }),
    )
    expect(result.error).toMatch(new RegExp(String(MIN_PASSWORD_LENGTH)))
  })

  it('確認用パスワードと一致しない場合は失敗する', async () => {
    const user = await seedWithPassword('alice', 'pppppppp')
    await setAuthSession({ id: user.id, role: 'member', mustChangePassword: true })

    const result = await changePasswordAction(
      {},
      formOf({
        currentPassword: 'pppppppp',
        newPassword: 'newpassword123',
        confirmPassword: 'different123',
      }),
    )
    expect(result.error).toMatch(/一致しません/)
  })

  it('未認証では失敗する', async () => {
    await setAuthSession(null)
    const result = await changePasswordAction(
      {},
      formOf({
        currentPassword: 'pppppppp',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      }),
    )
    expect(result.error).toMatch(/ログイン/)
  })
})
