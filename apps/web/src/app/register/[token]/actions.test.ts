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
  opts?: { token?: string; expiresAt?: Date; revokedAt?: Date | null; kind?: 'member' | 'guest' },
): Promise<string> {
  const token = opts?.token ?? 'valid-token'
  await testDb.insert(registrationInvites).values({
    token,
    kind: opts?.kind ?? 'member',
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
    createdBy,
    revokedAt: opts?.revokedAt ?? null,
  })
  return token
}

// Minimal guest-registration FormData: 表示名・級・所属会 only.
function guestForm(extra: Record<string, string> = {}): FormData {
  return formOf({
    name: '山田 太郎',
    grade: 'B',
    affiliation: 'よその会',
    ...extra,
  })
}

const NEXT_REDIRECT = { digest: expect.stringContaining('NEXT_REDIRECT') }

// ★ teardown はファイル単位で 1 回だけ。describe ごとに afterAll(closeTestDb)
// を置くと、先に終わった describe が後続 describe 用のプールまで閉じてしまい
// "Cannot use a pool after calling end on the pool" になる。
afterAll(async () => {
  await closeTestDb()
})

describe('registerViaInvite', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => vi.restoreAllMocks())

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

  // travel-report R1/AC-1/AC-3/AC-4: サークル所属 ON の必須項目・電話/生年月日の共用。
  it('サークル所属ON（D級・全日協無し）: 学部区分・学部等名・学年・電話・生年月日が保存される', async () => {
    const issuer = await createUser({ name: 'issuer-circle-1', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-1' })

    await expect(
      registerViaInvite(
        token,
        {},
        nameForm({
          grade: 'D',
          isCircleMember: 'on',
          facultyKind: 'graduate',
          faculty: '情報科学院',
          schoolYear: '修士1年',
          phone: '090-0000-0001',
          birthDate: '2003-01-01',
        }),
      ),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.isCircleMember).toBe(true)
    expect(created?.facultyKind).toBe('graduate')
    expect(created?.faculty).toBe('情報科学院')
    expect(created?.schoolYear).toBe('修士1年')
    expect(created?.phone).toBe('090-0000-0001')
    expect(created?.birthDate).toBe('2003-01-01')
    // D級なので全日協は false のまま。
    expect(created?.zenNichikyo).toBe(false)
  })

  it('サークル所属ON: 学部区分が欠けるとエラーで作成されない', async () => {
    const issuer = await createUser({ name: 'issuer-circle-2', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-2' })

    const result = await registerViaInvite(
      token,
      {},
      nameForm({ grade: 'D', isCircleMember: 'on', faculty: '工学部', schoolYear: '3年' }),
    )
    expect(result.error).toContain('所属')
    expect(
      await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Unew-circle-2') }),
    ).toBeUndefined()
  })

  it('サークル所属ON: 学部等名が空だとエラー', async () => {
    const issuer = await createUser({ name: 'issuer-circle-3', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-3' })

    const result = await registerViaInvite(
      token,
      {},
      nameForm({
        grade: 'D',
        isCircleMember: 'on',
        facultyKind: 'undergraduate',
        schoolYear: '3年',
        phone: '090-0000-0001',
        birthDate: '2003-01-01',
      }),
    )
    expect(result.error).toContain('学部等名')
  })

  it('サークル所属ON: 区分と整合しない学年（学部に「修士1年」）は拒否される', async () => {
    const issuer = await createUser({ name: 'issuer-circle-4', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-4' })

    const result = await registerViaInvite(
      token,
      {},
      nameForm({
        grade: 'D',
        isCircleMember: 'on',
        facultyKind: 'undergraduate',
        faculty: '工学部',
        schoolYear: '修士1年',
        phone: '090-0000-0001',
        birthDate: '2003-01-01',
      }),
    )
    expect(result.error).toContain('学年')
  })

  it('サークル所属ON: 候補外の学部等名も自由入力として保存できる（AC-4）', async () => {
    const issuer = await createUser({ name: 'issuer-circle-5', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-5' })

    await expect(
      registerViaInvite(
        token,
        {},
        nameForm({
          grade: 'D',
          isCircleMember: 'on',
          facultyKind: 'undergraduate',
          faculty: '候補外学部',
          schoolYear: '1年',
          phone: '090-0000-0001',
          birthDate: '2003-01-01',
        }),
      ),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.faculty).toBe('候補外学部')
  })

  it('サークル所属ON: 電話番号が欠けるとエラー（全日協が無い級でも必須）', async () => {
    const issuer = await createUser({ name: 'issuer-circle-6', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-6' })

    const result = await registerViaInvite(
      token,
      {},
      nameForm({
        grade: 'D',
        isCircleMember: 'on',
        facultyKind: 'undergraduate',
        faculty: '工学部',
        schoolYear: '3年',
        birthDate: '2003-01-01',
      }),
    )
    expect(result.error).toContain('電話番号')
  })

  it('サークル所属OFF: 学部属性は任意で null のまま作成できる', async () => {
    const issuer = await createUser({ name: 'issuer-circle-7', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-7' })

    await expect(
      registerViaInvite(token, {}, nameForm({ grade: 'D' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.isCircleMember).toBe(false)
    expect(created?.facultyKind).toBeNull()
    expect(created?.faculty).toBeNull()
    expect(created?.schoolYear).toBeNull()
  })

  it('AC-3: 全日協ONの電話・生年月日とサークル所属ONの電話・生年月日は同じ列に保存される', async () => {
    const issuer = await createUser({ name: 'issuer-circle-8', role: 'admin' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-circle-8' })

    await expect(
      registerViaInvite(
        token,
        {},
        zenForm({
          grade: 'B',
          isCircleMember: 'on',
          facultyKind: 'undergraduate',
          faculty: '法学部',
          schoolYear: '2年',
        }),
      ),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '山田 太郎') })
    expect(created?.zenNichikyo).toBe(true)
    expect(created?.isCircleMember).toBe(true)
    // zenForm の phone/birthDate がそのまま同じ列に入る（入力欄は1つ）。
    expect(created?.phone).toBe('090-1234-5678')
    expect(created?.birthDate).toBe('1990-04-01')
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

describe('registerViaInvite (guest invite)', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => vi.restoreAllMocks())

  it('ゲスト用トークンで登録: role=guest / is_invited=true / grade・affiliation を保存、PII 列は NULL', async () => {
    const issuer = await createUser({ name: 'guest-issuer-1', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-1' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-1' })

    await expect(
      registerViaInvite(token, {}, guestForm({ name: '来場 花子', grade: 'C', affiliation: '隣町かるた会' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '来場 花子') })
    expect(created).toBeDefined()
    expect(created?.role).toBe('guest')
    expect(created?.isInvited).toBe(true)
    expect(created?.invitedAt).toBeInstanceOf(Date)
    expect(created?.grade).toBe('C')
    expect(created?.affiliation).toBe('隣町かるた会')
    expect(created?.lineUserId).toBe('Uguest-1')
    expect(created?.lineLinkedMethod).toBe('invite_link')
    // 姓名・かな・段位・全日協・住所・電話等の PII 列は一切書かれない。
    expect(created?.familyName).toBeNull()
    expect(created?.givenName).toBeNull()
    expect(created?.familyKana).toBeNull()
    expect(created?.givenKana).toBeNull()
    expect(created?.dan).toBeNull()
    expect(created?.zenNichikyo).toBe(false)
    expect(created?.gender).toBeNull()
    expect(created?.birthDate).toBeNull()
    expect(created?.phone).toBeNull()
    expect(created?.postalCode).toBeNull()
    expect(created?.address1).toBeNull()
    expect(created?.address2).toBeNull()
  })

  it('ゲスト用トークンは会員用フォーム相当の入力が混入しても role=guest で作られる（クライアント入力の種別は信用しない）', async () => {
    const issuer = await createUser({ name: 'guest-issuer-2', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-2' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-2' })

    // 会員用フォーム相当のフィールド（姓名かな等）が混入していても、
    // ゲスト用トークンでは parseGuestRegistration の 3 項目しか読まれず、
    // role は常に 'guest'（formData 由来の役割選択は存在しない）。
    const fd = guestForm({
      name: '混入 太郎',
      grade: 'A',
      familyName: '混入',
      givenName: '太郎',
      familyKana: 'こんにゅう',
      givenKana: 'たろう',
      dan: '6',
      zenNichikyo: 'on',
    })

    await expect(registerViaInvite(token, {}, fd)).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '混入 太郎') })
    expect(created?.role).toBe('guest')
    expect(created?.familyName).toBeNull()
    expect(created?.dan).toBeNull()
    expect(created?.zenNichikyo).toBe(false)
  })

  it('ゲスト登録: 級未選択は拒否され、行は作成されない', async () => {
    const issuer = await createUser({ name: 'guest-issuer-3', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-3' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-3' })

    const result = await registerViaInvite(token, {}, guestForm({ grade: '' }))
    expect(result.error).toContain('級')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Uguest-3') })).toBeUndefined()
  })

  it('ゲスト登録: 所属会未入力は拒否され、行は作成されない', async () => {
    const issuer = await createUser({ name: 'guest-issuer-4', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-4' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-4' })

    const result = await registerViaInvite(token, {}, guestForm({ affiliation: '   ' }))
    expect(result.error).toContain('所属会')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Uguest-4') })).toBeUndefined()
  })

  it('ゲスト登録: 表示名未入力は拒否され、行は作成されない', async () => {
    const issuer = await createUser({ name: 'guest-issuer-5', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-5' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-5' })

    const result = await registerViaInvite(token, {}, guestForm({ name: '   ' }))
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Uguest-5') })).toBeUndefined()
  })

  it('ゲスト登録: 表示名が既存ユーザーと衝突すると日本語エラーで拒否される', async () => {
    const issuer = await createUser({ name: 'guest-issuer-6', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-6' })
    await createUser({ name: '山田 太郎', lineUserId: null })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-6' })

    const result = await registerViaInvite(token, {}, guestForm({ name: '山田 太郎' }))
    expect(result.error).toBe('同名の会員が既に存在します。管理者にご連絡ください。')
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Uguest-6') })).toBeUndefined()
  })

  it('ゲスト登録: 同一LINEアカウントの二重登録は / へ誘導し、新規行は作られない', async () => {
    const issuer = await createUser({ name: 'guest-issuer-7', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-7' })
    await createUser({ name: '既存 ゲスト', role: 'guest', lineUserId: 'Uguestdup', isInvited: true })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguestdup' })

    await expect(
      registerViaInvite(token, {}, guestForm({ name: '別名 ゲスト' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    expect(await testDb.query.users.findFirst({ where: eq(users.name, '別名 ゲスト') })).toBeUndefined()
    expect(await testDb.select().from(users).where(eq(users.lineUserId, 'Uguestdup'))).toHaveLength(1)
  })

  it('ゲスト用トークンも期限切れ・無効化の扱いは会員用と同じ', async () => {
    const issuer = await createUser({ name: 'guest-issuer-8', role: 'admin' })
    const expiredToken = await seedInvite(issuer.id, {
      kind: 'guest',
      token: 'guest-token-expired',
      expiresAt: new Date(Date.now() - DAY_MS),
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-8' })

    const result = await registerViaInvite(expiredToken, {}, guestForm())
    expect(result.error).toBeDefined()
    expect(await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Uguest-8') })).toBeUndefined()
  })

  // travel-report R1/AC-2: ゲストもサークル所属 ON なら姓・名（漢字）＋学部属性＋
  // 電話・生年月日が必須になり、保存後に分割氏名を持つ。
  it('AC-2: ゲスト＋サークル所属ON: 姓・名・学部属性・電話・生年月日が保存される（分割氏名を持つ）', async () => {
    const issuer = await createUser({ name: 'guest-issuer-9', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-9' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-9' })

    await expect(
      registerViaInvite(
        token,
        {},
        guestForm({
          name: '函館 大地',
          isCircleMember: 'on',
          familyName: '函館',
          givenName: '大地',
          facultyKind: 'undergraduate',
          faculty: '経済学部',
          schoolYear: '2年',
          phone: '080-0000-0010',
          birthDate: '2005-08-08',
        }),
      ),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '函館 大地') })
    expect(created?.role).toBe('guest')
    expect(created?.isCircleMember).toBe(true)
    expect(created?.familyName).toBe('函館')
    expect(created?.givenName).toBe('大地')
    // ゲストにかなは聞かない。
    expect(created?.familyKana).toBeNull()
    expect(created?.givenKana).toBeNull()
    expect(created?.facultyKind).toBe('undergraduate')
    expect(created?.faculty).toBe('経済学部')
    expect(created?.schoolYear).toBe('2年')
    expect(created?.phone).toBe('080-0000-0010')
    expect(created?.birthDate).toBe('2005-08-08')
  })

  it('ゲスト＋サークル所属ON: 姓が欠けるとエラーで作成されない', async () => {
    const issuer = await createUser({ name: 'guest-issuer-10', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-10' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-10' })

    const result = await registerViaInvite(
      token,
      {},
      guestForm({
        isCircleMember: 'on',
        givenName: '大地',
        facultyKind: 'undergraduate',
        faculty: '経済学部',
        schoolYear: '2年',
        phone: '080-0000-0010',
        birthDate: '2005-08-08',
      }),
    )
    expect(result.error).toContain('姓')
    expect(
      await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Uguest-10') }),
    ).toBeUndefined()
  })

  it('ゲスト＋サークル所属OFF: 学部属性は null のまま作成できる', async () => {
    const issuer = await createUser({ name: 'guest-issuer-11', role: 'admin' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-token-11' })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Uguest-11' })

    await expect(
      registerViaInvite(token, {}, guestForm({ name: '通常 ゲスト' })),
    ).rejects.toMatchObject(NEXT_REDIRECT)

    const created = await testDb.query.users.findFirst({ where: eq(users.name, '通常 ゲスト') })
    expect(created?.isCircleMember).toBe(false)
    expect(created?.familyName).toBeNull()
    expect(created?.facultyKind).toBeNull()
  })
})
