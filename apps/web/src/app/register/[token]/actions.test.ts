import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { registrationInvites, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => {
  const mod = mockAuthModule() as unknown as Record<string, unknown>
  mod.unstable_update = vi.fn().mockResolvedValue(null)
  return mod
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { registerViaInvite } = await import('./actions')

const DAY_MS = 24 * 60 * 60 * 1000

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.set(k, v)
  return fd
}

function expectRedirect(err: unknown, pathPart: string) {
  if (typeof err !== 'object' || err === null) throw err
  const digest = (err as { digest?: unknown }).digest
  if (typeof digest !== 'string' || !digest.includes('NEXT_REDIRECT')) throw err
  if (!digest.includes(pathPart)) {
    throw new Error(`expected redirect to include "${pathPart}", got "${digest}"`)
  }
}

async function seedInvite(
  createdBy: string,
  opts?: { token?: string; expiresAt?: Date; revokedAt?: Date | null },
): Promise<string> {
  const token = opts?.token ?? 'valid-token'
  await testDb.insert(registrationInvites).values({
    token,
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
    createdBy,
    revokedAt: opts?.revokedAt ?? null,
  })
  return token
}

const NEXT_REDIRECT = { digest: expect.stringContaining('NEXT_REDIRECT') }

describe('registerViaInvite', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await closeTestDb()
  })

  it('正常系: 氏名+級 → role=member / method=invite_link / lineUserId 紐付け で作成され / へ', async () => {
    const issuer = await createUser({ name: 'issuer-1', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-1' })

    await expect(
      registerViaInvite(token, {}, formOf({ name: '新人太郎', grade: 'C' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '新人太郎') })
    expect(created).toBeDefined()
    expect(created?.role).toBe('member')
    expect(created?.isInvited).toBe(true)
    expect(created?.invitedAt).toBeInstanceOf(Date)
    expect(created?.grade).toBe('C')
    expect(created?.lineUserId).toBe('Unew-1')
    expect(created?.lineLinkedMethod).toBe('invite_link')
    expect(created?.lineLinkedAt).toBeInstanceOf(Date)
  })

  it('級未選択でも作成できる（grade=null）', async () => {
    const issuer = await createUser({ name: 'issuer-2', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-2' })

    await expect(
      registerViaInvite(token, {}, formOf({ name: '級なし花子', grade: '' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '級なし花子') })
    expect(created?.grade).toBeNull()
    expect(created?.lineLinkedMethod).toBe('invite_link')
  })

  it('期限切れトークンは拒否、会員は作成されない', async () => {
    const issuer = await createUser({ name: 'issuer-3', role: 'admin' })
    const token = await seedInvite(issuer.id, { expiresAt: new Date(Date.now() - DAY_MS) })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-3' })

    const result = await registerViaInvite(token, {}, formOf({ name: '期限切れ人', grade: '' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-3') })).toBeUndefined()
  })

  it('無効化済みトークンは拒否', async () => {
    const issuer = await createUser({ name: 'issuer-4', role: 'admin' })
    const token = await seedInvite(issuer.id, { revokedAt: new Date() })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-4' })

    const result = await registerViaInvite(token, {}, formOf({ name: '無効化人', grade: '' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-4') })).toBeUndefined()
  })

  it('存在しないトークンは拒否', async () => {
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-5' })
    const result = await registerViaInvite('no-such-token', {}, formOf({ name: '幽霊', grade: '' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-5') })).toBeUndefined()
  })

  it('氏名未入力はエラー、会員は作成されない', async () => {
    const issuer = await createUser({ name: 'issuer-6', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-6' })

    const result = await registerViaInvite(token, {}, formOf({ name: '   ', grade: '' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-6') })).toBeUndefined()
  })

  it('同名の会員が既に存在するとエラー（退会済み含む）', async () => {
    const issuer = await createUser({ name: 'issuer-7', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await createUser({ name: '重複君', deactivatedAt: new Date(), lineUserId: null })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-7' })

    const result = await registerViaInvite(token, {}, formOf({ name: '重複君', grade: '' }))
    expect(result.error).toBe('同名の会員が既に存在します。管理者にご連絡ください。')
    // The new LINE account was not bound to anything.
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-7') })).toBeUndefined()
  })

  it('同一LINEアカウントの二重登録は / へ誘導し、新規行は作られない', async () => {
    const issuer = await createUser({ name: 'issuer-8', role: 'admin' })
    const token = await seedInvite(issuer.id)
    // This LINE account already has a member row (different name).
    await createUser({ name: '既存会員', lineUserId: 'Udup', isInvited: true })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Udup' })

    await expect(
      registerViaInvite(token, {}, formOf({ name: '別名前', grade: '' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    // No new row for the new name; the LINE account still maps to exactly one row.
    expect(await testDb.query.users.findFirst({ where: eq(users.name, '別名前') })).toBeUndefined()
    expect(await testDb.select().from(users).where(eq(users.lineUserId, 'Udup'))).toHaveLength(1)
  })

  it('既にバインド済み (session.user.id あり) は / へ、作成しない', async () => {
    const issuer = await createUser({ name: 'issuer-9', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: 'some-internal-id', role: 'member', lineUserId: 'Ubound' })

    await expect(
      registerViaInvite(token, {}, formOf({ name: 'バインド済み', grade: '' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)
    expect(await testDb.query.users.findFirst({ where: eq(users.name, 'バインド済み') })).toBeUndefined()
  })

  it('LINEセッションが無い場合は /register/<token> へ戻す', async () => {
    const issuer = await createUser({ name: 'issuer-10', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession(null)

    try {
      await registerViaInvite(token, {}, formOf({ name: 'セッション無し', grade: '' }))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, `/register/${token}`)
    }
    expect(await testDb.query.users.findFirst({ where: eq(users.name, 'セッション無し') })).toBeUndefined()
  })
})
