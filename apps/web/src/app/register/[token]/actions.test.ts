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

// Default structured-name fields. `extra` overrides / adds grade, dan, PII, etc.
function nameForm(extra: Record<string, string> = {}): FormData {
  return formOf({
    familyName: '山田',
    givenName: '太郎',
    familyKana: 'やまだ',
    givenKana: 'たろう',
    ...extra,
  })
}

// Full A/B/C 全日協 ON payload (all PII present).
function zenForm(extra: Record<string, string> = {}): FormData {
  return nameForm({
    grade: 'B',
    zenNichikyo: 'on',
    gender: 'male',
    birthDate: '1990-04-01',
    phone: '090-1234-5678',
    postalCode: '001-0010',
    address1: '札幌市北区北十条西1-1',
    ...extra,
  })
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

  it('正常系(D級): 構造化氏名+級 → role=member / method=invite_link / 合成name で作成され / へ', async () => {
    const issuer = await createUser({ name: 'issuer-1', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-1' })

    await expect(
      registerViaInvite(token, {}, nameForm({ grade: 'D' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created).toBeDefined()
    expect(created?.role).toBe('member')
    expect(created?.isInvited).toBe(true)
    expect(created?.invitedAt).toBeInstanceOf(Date)
    expect(created?.familyName).toBe('山田')
    expect(created?.givenName).toBe('太郎')
    expect(created?.familyKana).toBe('やまだ')
    expect(created?.givenKana).toBe('たろう')
    expect(created?.grade).toBe('D')
    // D級は段位・全日協・PII を持たない（サーバー強制）。
    expect(created?.dan).toBeNull()
    expect(created?.zenNichikyo).toBe(false)
    expect(created?.gender).toBeNull()
    expect(created?.birthDate).toBeNull()
    expect(created?.phone).toBeNull()
    expect(created?.postalCode).toBeNull()
    expect(created?.address1).toBeNull()
    expect(created?.address2).toBeNull()
    expect(created?.lineUserId).toBe('Unew-1')
    expect(created?.lineLinkedMethod).toBe('invite_link')
    expect(created?.lineLinkedAt).toBeInstanceOf(Date)
  })

  it('級未選択でも作成できる（grade=null・全日協 false・PII null）', async () => {
    const issuer = await createUser({ name: 'issuer-2', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-2' })

    await expect(
      registerViaInvite(token, {}, nameForm({ familyName: '級', givenName: 'なし', grade: '' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '級 なし') })
    expect(created?.grade).toBeNull()
    expect(created?.zenNichikyo).toBe(false)
    expect(created?.lineLinkedMethod).toBe('invite_link')
  })

  it('A級: 段位必須・四〜八段を保存、全日協ON で PII 保存', async () => {
    const issuer = await createUser({ name: 'issuer-A', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-A' })

    await expect(
      registerViaInvite(
        token,
        {},
        zenForm({ familyName: '段位', givenName: '持', grade: 'A', dan: '6' }),
      ),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '段位 持') })
    expect(created?.grade).toBe('A')
    expect(created?.dan).toBe(6)
    expect(created?.zenNichikyo).toBe(true)
    expect(created?.gender).toBe('male')
    expect(created?.birthDate).toBe('1990-04-01')
    expect(created?.phone).toBe('090-1234-5678')
    // 郵便番号はハイフン除去の7桁に正規化保存。
    expect(created?.postalCode).toBe('0010010')
    expect(created?.address1).toBe('札幌市北区北十条西1-1')
  })

  it('A級で段位未指定はエラー、会員は作成されない', async () => {
    const issuer = await createUser({ name: 'issuer-A2', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-A2' })

    const result = await registerViaInvite(token, {}, nameForm({ grade: 'A', zenNichikyo: '' }))
    expect(result.error).toContain('段位')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-A2') })).toBeUndefined()
  })

  it('B/C級 全日協ON: 全PII を保存、住所2(任意)は空なら null', async () => {
    const issuer = await createUser({ name: 'issuer-BC', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-BC' })

    await expect(
      registerViaInvite(token, {}, zenForm({ grade: 'C', address2: '' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.zenNichikyo).toBe(true)
    expect(created?.address2).toBeNull()
  })

  it('B/C級 全日協ON: 住所2 入力時は保存する', async () => {
    const issuer = await createUser({ name: 'issuer-BC2', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-BC2' })

    await expect(
      registerViaInvite(token, {}, zenForm({ grade: 'C', address2: 'カゲトラマンション101' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.address2).toBe('カゲトラマンション101')
  })

  it('全日協OFF: PII は送られても保存しない（null・zenNichikyo=false）', async () => {
    const issuer = await createUser({ name: 'issuer-off', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-off' })

    await expect(
      registerViaInvite(
        token,
        {},
        // grade B but checkbox off; PII fields present but must be discarded.
        zenForm({ grade: 'B', zenNichikyo: 'false' }),
      ),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.zenNichikyo).toBe(false)
    expect(created?.gender).toBeNull()
    expect(created?.birthDate).toBeNull()
    expect(created?.phone).toBeNull()
    expect(created?.postalCode).toBeNull()
    expect(created?.address1).toBeNull()
  })

  it('D/E級は全日協チェックON送信でも false・PII null に強制（サーバー不変条件）', async () => {
    const issuer = await createUser({ name: 'issuer-de', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-de' })

    await expect(
      registerViaInvite(token, {}, zenForm({ grade: 'E', zenNichikyo: 'on' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.grade).toBe('E')
    expect(created?.zenNichikyo).toBe(false)
    expect(created?.gender).toBeNull()
    expect(created?.postalCode).toBeNull()
  })

  it('全日協ON で性別未選択はフィールド特定エラー', async () => {
    const issuer = await createUser({ name: 'issuer-g', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-g' })

    const result = await registerViaInvite(token, {}, zenForm({ grade: 'B', gender: '' }))
    expect(result.error).toContain('性別')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-g') })).toBeUndefined()
  })

  it('全日協ON で郵便番号が7桁でないとエラー', async () => {
    const issuer = await createUser({ name: 'issuer-z', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-z' })

    const result = await registerViaInvite(token, {}, zenForm({ grade: 'B', postalCode: '123' }))
    expect(result.error).toContain('郵便番号')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-z') })).toBeUndefined()
  })

  it('全日協ON で電話番号の桁数が不正だとエラー', async () => {
    const issuer = await createUser({ name: 'issuer-p', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-p' })

    const result = await registerViaInvite(token, {}, zenForm({ grade: 'B', phone: '012' }))
    expect(result.error).toContain('電話番号')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-p') })).toBeUndefined()
  })

  it('全日協ON で住所1 未入力はエラー', async () => {
    const issuer = await createUser({ name: 'issuer-a1', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-a1' })

    const result = await registerViaInvite(token, {}, zenForm({ grade: 'B', address1: '  ' }))
    expect(result.error).toContain('住所')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-a1') })).toBeUndefined()
  })

  it('ふりがながひらがな以外（漢字/カタカナ）はエラー', async () => {
    const issuer = await createUser({ name: 'issuer-kana', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-kana' })

    const result = await registerViaInvite(token, {}, nameForm({ familyKana: 'ヤマダ', grade: 'D' }))
    expect(result.error).toContain('ひらがな')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-kana') })).toBeUndefined()
  })

  it('期限切れトークンは拒否、会員は作成されない', async () => {
    const issuer = await createUser({ name: 'issuer-3', role: 'admin' })
    const token = await seedInvite(issuer.id, { expiresAt: new Date(Date.now() - DAY_MS) })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-3' })

    const result = await registerViaInvite(token, {}, nameForm({ grade: 'D' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-3') })).toBeUndefined()
  })

  it('無効化済みトークンは拒否', async () => {
    const issuer = await createUser({ name: 'issuer-4', role: 'admin' })
    const token = await seedInvite(issuer.id, { revokedAt: new Date() })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-4' })

    const result = await registerViaInvite(token, {}, nameForm({ grade: 'D' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-4') })).toBeUndefined()
  })

  it('存在しないトークンは拒否', async () => {
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-5' })
    const result = await registerViaInvite('no-such-token', {}, nameForm({ grade: 'D' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-5') })).toBeUndefined()
  })

  it('姓・名 未入力はエラー、会員は作成されない', async () => {
    const issuer = await createUser({ name: 'issuer-6', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-6' })

    const result = await registerViaInvite(token, {}, nameForm({ familyName: '   ', grade: 'D' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-6') })).toBeUndefined()
  })

  it('合成名(姓 名)が既存会員と衝突するとエラー（退会済み含む）', async () => {
    const issuer = await createUser({ name: 'issuer-7', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await createUser({ name: '山田 太郎', deactivatedAt: new Date(), lineUserId: null })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-7' })

    const result = await registerViaInvite(token, {}, nameForm({ grade: 'D' }))
    expect(result.error).toBe('同名の会員が既に存在します。管理者にご連絡ください。')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-7') })).toBeUndefined()
  })

  it('同一LINEアカウントの二重登録は / へ誘導し、新規行は作られない', async () => {
    const issuer = await createUser({ name: 'issuer-8', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await createUser({ name: '既存 会員', lineUserId: 'Udup', isInvited: true })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Udup' })

    await expect(
      registerViaInvite(token, {}, nameForm({ familyName: '別', givenName: '名前', grade: 'D' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    expect(await testDb.query.users.findFirst({ where: eq(users.name, '別 名前') })).toBeUndefined()
    expect(await testDb.select().from(users).where(eq(users.lineUserId, 'Udup'))).toHaveLength(1)
  })

  it('既にバインド済み (session.user.id あり) は / へ、作成しない', async () => {
    const issuer = await createUser({ name: 'issuer-9', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: 'some-internal-id', role: 'member', lineUserId: 'Ubound' })

    await expect(
      registerViaInvite(token, {}, nameForm({ familyName: 'バインド', givenName: '済', grade: 'D' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)
    expect(await testDb.query.users.findFirst({ where: eq(users.name, 'バインド 済') })).toBeUndefined()
  })

  it('LINEセッションが無い場合は /register/<token> へ戻す', async () => {
    const issuer = await createUser({ name: 'issuer-10', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession(null)

    try {
      await registerViaInvite(token, {}, nameForm({ grade: 'D' }))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, `/register/${token}`)
    }
    expect(await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })).toBeUndefined()
  })
})
