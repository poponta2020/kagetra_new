import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { ROSTER_CLAIM_MESSAGES } from '@/lib/roster-claim'

vi.mock('@/auth', () => {
  const mod = mockAuthModule() as unknown as Record<string, unknown>
  mod.unstable_update = vi.fn().mockResolvedValue(null)
  return mod
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { claimMemberIdentity } = await import('./actions')

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.set(k, v)
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

type UserRow = typeof users.$inferSelect

async function fetchUser(id: string): Promise<UserRow> {
  const [row] = await testDb.select().from(users).where(eq(users.id, id))
  if (!row) throw new Error('user not found')
  return row
}

// Columns whose values differ between `before` and `after`, comparing Date
// fields by epoch millis. (同じヘルパーを apps/web/src/lib/roster-claim.test.ts
// でも使っている。)
function changedColumns(before: UserRow, after: UserRow): string[] {
  const beforeRec = before as unknown as Record<string, unknown>
  const afterRec = after as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(beforeRec), ...Object.keys(afterRec)])
  const changed: string[] = []
  for (const k of keys) {
    const b = beforeRec[k]
    const a = afterRec[k]
    const bVal = b instanceof Date ? b.getTime() : b
    const aVal = a instanceof Date ? a.getTime() : a
    if (bVal !== aVal) changed.push(k)
  }
  return changed.sort()
}

// A fully-populated candidate row so a "no unexpected columns changed" check
// is meaningful — every writable column starts non-default/non-null.
async function createFullCandidate(overrides: Partial<Parameters<typeof createUser>[0]> = {}) {
  const uid = crypto.randomUUID()
  return createUser({
    name: `self-identify-full-${uid}`,
    email: `self-identify-full-${uid}@example.com`,
    familyName: '佐藤',
    givenName: '花子',
    familyKana: 'さとう',
    givenKana: 'はなこ',
    grade: 'B',
    gender: 'male',
    zenNichikyo: true,
    birthDate: '1990-04-01',
    phone: '090-1111-2222',
    postalCode: '0010010',
    address1: '札幌市北区北十条西1-1',
    address2: '北棟101',
    affiliation: '北海道大学かるた会',
    role: 'member',
    isTreasurer: false,
    isInvited: true,
    lineUserId: null,
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...overrides,
  })
}

describe('claimMemberIdentity', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await closeTestDb()
  })

  it('正常系(所属OFF): 未リンクの招待会員を選択 → lineUserId + lineLinkedAt + method=self_identify が書かれ、isCircleMember=false', async () => {
    const alice = await createUser({
      name: 'alice',
      isInvited: true,
      lineUserId: null,
    })
    // id: '' = unlinked (buildMockSession requires string, action checks !session.user.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-xyz' })

    await expect(
      claimMemberIdentity({}, formOf({ userId: alice.id })),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const updated = await fetchUser(alice.id)
    expect(updated.lineUserId).toBe('Unew-xyz')
    expect(updated.lineLinkedMethod).toBe('self_identify')
    expect(updated.lineLinkedAt).toBeInstanceOf(Date)
    expect(updated.isCircleMember).toBe(false)
  })

  // travel-report AC-8: 所属 ON でサークル所属ブロックの3項目が保存され、
  // self_identify で紐付く。
  it('AC-8: 所属ON（大学院）: facultyKind/faculty/schoolYear が保存され、self_identify で紐付く', async () => {
    // 電話・生年月日は登録済み（空なら所属 ON で入力必須になるため）。
    const bob = await createUser({
      name: 'bob',
      isInvited: true,
      lineUserId: null,
      phone: '090-1111-2222',
      birthDate: '1995-05-05',
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-grad' })

    await expect(
      claimMemberIdentity(
        {},
        formOf({
          userId: bob.id,
          isCircleMember: 'on',
          facultyKind: 'graduate',
          faculty: '情報科学院',
          schoolYear: '修士1年',
        }),
      ),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const updated = await fetchUser(bob.id)
    expect(updated.isCircleMember).toBe(true)
    expect(updated.facultyKind).toBe('graduate')
    expect(updated.faculty).toBe('情報科学院')
    expect(updated.schoolYear).toBe('修士1年')
    expect(updated.lineUserId).toBe('Unew-grad')
    expect(updated.lineLinkedMethod).toBe('self_identify')
  })

  // AC-8 → AC-4 と同じ: 更新列の範囲は明示列挙のみ、敵対的な余剰フィールドは無視される。
  it('AC-8/AC-4: 全列を埋めた候補への更新は、期待した列だけが変わり敵対的フィールドは無視される', async () => {
    const candidate = await createFullCandidate()
    const before = await fetchUser(candidate.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-hostile' })

    const formData = formOf({
      userId: candidate.id,
      isCircleMember: 'on',
      facultyKind: 'graduate',
      faculty: '情報科学院',
      schoolYear: '修士1年',
      // Hostile extras that must be ignored.
      role: 'admin',
      name: '別人 太郎',
      grade: 'A',
      address1: '偽住所',
      zenNichikyo: 'on',
    })

    await expect(claimMemberIdentity({}, formData)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const after = await fetchUser(candidate.id)
    expect(changedColumns(before, after)).toEqual(
      [
        'faculty',
        'facultyKind',
        'isCircleMember',
        'lineLinkedAt',
        'lineLinkedMethod',
        'lineUserId',
        'schoolYear',
        'updatedAt',
      ].sort(),
    )
    expect(after.role).toBe('member')
    expect(after.name).toBe(before.name)
    expect(after.grade).toBe('B')
    expect(after.address1).toBe(before.address1)
  })

  it('所属ON: 学部等名が欠けるとエラーが state で返り、行は未紐付けのまま', async () => {
    const carol = await createUser({
      name: 'carol-faculty-missing',
      isInvited: true,
      lineUserId: null,
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-nofaculty' })

    const result = await claimMemberIdentity(
      {},
      formOf({
        userId: carol.id,
        isCircleMember: 'on',
        facultyKind: 'undergraduate',
        schoolYear: '1年',
      }),
    )
    expect(result).toEqual({ error: '学部等名を入力してください' })

    const unchanged = await fetchUser(carol.id)
    expect(unchanged.lineUserId).toBeNull()
    expect(unchanged.isCircleMember).toBe(false)
  })

  it('未招待の会員を選ぶと unavailable エラーが state で返り、DB 無変化、/self-identify を revalidate', async () => {
    const { revalidatePath } = await import('next/cache')
    const dave = await createUser({
      name: 'dave-uninvited',
      isInvited: false,
      lineUserId: null,
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-1' })

    const result = await claimMemberIdentity({}, formOf({ userId: dave.id }))
    expect(result).toEqual({ error: ROSTER_CLAIM_MESSAGES.unavailable })
    expect(revalidatePath).toHaveBeenCalledWith('/self-identify')

    const unchanged = await fetchUser(dave.id)
    expect(unchanged.lineUserId).toBeNull()
    expect(unchanged.lineLinkedMethod).toBeNull()
  })

  it('退会済みの会員を選ぶと unavailable エラー、DB 無変化', async () => {
    const erin = await createUser({
      name: 'erin-deactivated',
      isInvited: true,
      lineUserId: null,
      deactivatedAt: new Date(),
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-2' })

    const result = await claimMemberIdentity({}, formOf({ userId: erin.id }))
    expect(result).toEqual({ error: ROSTER_CLAIM_MESSAGES.unavailable })
    const unchanged = await fetchUser(erin.id)
    expect(unchanged.lineUserId).toBeNull()
  })

  it('既に誰かが紐付け済みの会員を選ぶと unavailable エラー、DB は Uother のまま', async () => {
    const frank = await createUser({
      name: 'frank-linked',
      isInvited: true,
      lineUserId: 'Uother',
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-3' })

    const result = await claimMemberIdentity({}, formOf({ userId: frank.id }))
    expect(result).toEqual({ error: ROSTER_CLAIM_MESSAGES.unavailable })
    const unchanged = await fetchUser(frank.id)
    expect(unchanged.lineUserId).toBe('Uother')
  })

  it('同じ lineUserId が別の行に既にある場合は duplicate エラー、候補は無変化', async () => {
    await createUser({ name: 'dup-owner', isInvited: true, lineUserId: 'Udup' })
    const target = await createUser({
      name: 'dup-target',
      isInvited: true,
      lineUserId: null,
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Udup' })

    const result = await claimMemberIdentity({}, formOf({ userId: target.id }))
    expect(result).toEqual({ error: ROSTER_CLAIM_MESSAGES.duplicate })

    const unchanged = await fetchUser(target.id)
    expect(unchanged.lineUserId).toBeNull()
  })

  it('userId formData が欠けていると invalid エラー', async () => {
    const alice = await createUser({
      name: 'alice-noid',
      isInvited: true,
      lineUserId: null,
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-4' })

    const result = await claimMemberIdentity({}, new FormData())
    expect(result).toEqual({ error: '選択内容が無効です。もう一度お試しください。' })
    const unchanged = await fetchUser(alice.id)
    expect(unchanged.lineUserId).toBeNull()
  })

  it('session に lineUserId が無い場合は /auth/signin へ', async () => {
    // No session set (mockAuth returns null by default)
    const alice = await createUser({
      name: 'alice-nosession',
      isInvited: true,
      lineUserId: null,
    })
    try {
      await claimMemberIdentity({}, formOf({ userId: alice.id }))
      throw new Error('expected redirect')
    } catch (err) {
      expectRedirect(err, '/auth/signin')
    }
    const unchanged = await fetchUser(alice.id)
    expect(unchanged.lineUserId).toBeNull()
  })

  it('既にバインド済み (session.user.id あり) は / へ、DB 無変化', async () => {
    const alice = await createUser({
      name: 'alice-bound',
      isInvited: true,
      lineUserId: null,
    })
    await setAuthSession({ id: 'some-internal-id', role: 'member', lineUserId: 'Ubound' })

    try {
      await claimMemberIdentity({}, formOf({ userId: alice.id }))
      throw new Error('expected redirect')
    } catch (err) {
      // digest 形式は `NEXT_REDIRECT;<type>;<url>;<status>;` — ルート `/` への
      // 遷移だけを拾う（`/auth/signin` 等の部分一致を避ける）。
      expectRedirect(err, ';/;')
    }
    const unchanged = await fetchUser(alice.id)
    expect(unchanged.lineUserId).toBeNull()
  })
})
