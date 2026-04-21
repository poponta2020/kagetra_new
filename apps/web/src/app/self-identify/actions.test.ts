import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => {
  const mod = mockAuthModule() as unknown as Record<string, unknown>
  mod.unstable_update = vi.fn().mockResolvedValue(null)
  return mod
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { claimMemberIdentity } = await import('./actions')

function makeFormData(userId: string): FormData {
  const fd = new FormData()
  fd.set('userId', userId)
  return fd
}

function expectRedirect(err: unknown, pathPart: string) {
  // next/navigation redirect() throws an error whose digest starts with NEXT_REDIRECT
  if (typeof err !== 'object' || err === null) throw err
  const digest = (err as { digest?: unknown }).digest
  if (typeof digest !== 'string' || !digest.includes('NEXT_REDIRECT')) throw err
  if (!digest.includes(pathPart)) {
    throw new Error(
      `expected redirect to include "${pathPart}", got "${digest}"`,
    )
  }
}

describe('claimMemberIdentity', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await closeTestDb()
  })

  it('正常系: 未リンクの招待会員を選択 → lineUserId + lineLinkedAt + method=self_identify が書かれる', async () => {
    const alice = await createUser({
      name: 'alice',
      isInvited: true,
      lineUserId: null,
    })
    // id: '' = unlinked (buildMockSession requires string, action checks !session.user.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-xyz' })

    await expect(
      claimMemberIdentity(makeFormData(alice.id)),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const updated = await testDb.query.users.findFirst({
      where: eq(users.id, alice.id),
    })
    expect(updated?.lineUserId).toBe('Unew-xyz')
    expect(updated?.lineLinkedMethod).toBe('self_identify')
    expect(updated?.lineLinkedAt).toBeInstanceOf(Date)
  })

  it('未招待の会員を選ぶと error=unavailable、DB 無変化', async () => {
    const carol = await createUser({
      name: 'carol',
      isInvited: false,
      lineUserId: null,
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-1' })

    try {
      await claimMemberIdentity(makeFormData(carol.id))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, 'error=unavailable')
    }

    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, carol.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
    expect(unchanged?.lineLinkedMethod).toBeNull()
  })

  it('退会済みの会員を選ぶと error=unavailable、DB 無変化', async () => {
    const dave = await createUser({
      name: 'dave',
      isInvited: true,
      lineUserId: null,
      deactivatedAt: new Date(),
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-2' })

    try {
      await claimMemberIdentity(makeFormData(dave.id))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, 'error=unavailable')
    }
    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, dave.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })

  it('既に誰かが紐付け済みの会員を選ぶと error=unavailable', async () => {
    const erin = await createUser({
      name: 'erin',
      isInvited: true,
      lineUserId: 'Uother',
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-3' })

    try {
      await claimMemberIdentity(makeFormData(erin.id))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, 'error=unavailable')
    }
    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, erin.id),
    })
    expect(unchanged?.lineUserId).toBe('Uother')
  })

  it('userId formData が欠けていると error=invalid_input', async () => {
    const alice = await createUser({
      name: 'alice',
      isInvited: true,
      lineUserId: null,
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-4' })

    const fd = new FormData()
    try {
      await claimMemberIdentity(fd)
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, 'error=invalid_input')
    }
    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, alice.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })

  it('session に lineUserId が無い場合は /auth/signin へ', async () => {
    // No session set (mockAuth returns null by default)
    const alice = await createUser({
      name: 'alice',
      isInvited: true,
      lineUserId: null,
    })
    try {
      await claimMemberIdentity(makeFormData(alice.id))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, '/auth/signin')
    }
    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, alice.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })
})
