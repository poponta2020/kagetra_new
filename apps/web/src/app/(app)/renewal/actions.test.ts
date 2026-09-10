import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  membershipRenewalMembers,
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { startRenewal } from '@/lib/membership-renewal/store'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { submitRenewalAnswer } = await import('./actions')

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

const FULL_PROFILE = {
  zenNichikyo: true,
  familyName: '北海',
  givenName: '太郎',
  familyKana: 'ほっかい',
  givenKana: 'たろう',
  birthDate: '2004-06-12',
  gender: 'male' as const,
  grade: 'B' as const,
  postalCode: '0010017',
  address1: '札幌市北区北17条西3-1-38',
  phone: '090-0000-0000',
}

afterAll(async () => {
  await closeTestDb()
  if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
})

beforeEach(async () => {
  await truncateAll()
  process.env.PUBLIC_BASE_URL = 'https://example.test'
})

function formOf(data: Record<string, string | number | boolean>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, String(v))
  return fd
}

async function seedStarted() {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 's',
      channelAccessToken: 't',
      botId: '@club-bot',
      purpose: 'club_chat',
      status: 'assigned',
    })
    .returning({ id: lineChannels.id })
  await testDb.insert(clubLineGroups).values({
    lineChannelId: channel!.id,
    oamAccountPath: 'U16c4a1b2c3d4e5f60718293a4b5c6d70',
    oamChatRoomId: 'C432c0102030405060708090a0b0c0d0e',
    chatRoomName: '会グループ',
  })
  const admin = await createAdmin({ name: 'admin' })
  const member = await createUser({ name: '北海 太郎', ...FULL_PROFILE })
  const other = await createUser({ name: '別の会員', ...FULL_PROFILE })
  const started = await startRenewal(
    { fiscalYear: 2027, deadline: '2027-03-25', note: null },
    admin.id,
    new Date('2027-03-10T03:00:00Z'),
  )
  return { admin, member, other, renewalId: (started as { renewalId: number }).renewalId }
}

async function answerOf(renewalId: number, userId: string) {
  const [row] = await testDb
    .select()
    .from(membershipRenewalMembers)
    .where(eq(membershipRenewalMembers.userId, userId))
  return row?.renewalId === renewalId ? row.answer : undefined
}

describe('submitRenewalAnswer', () => {
  it('本人の回答を保存する', async () => {
    const { member, renewalId } = await seedStarted()
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await submitRenewalAnswer(
      {},
      formOf({ renewalId: String(renewalId), answer: 'register', ...FULL_PROFILE, dan: '' }),
    )
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(await answerOf(renewalId, member.id)).toBe('register')
  })

  it('未ログインでは書けない', async () => {
    const { member, renewalId } = await seedStarted()
    await setAuthSession(null)

    const result = await submitRenewalAnswer(
      {},
      formOf({ renewalId: String(renewalId), answer: 'not_register' }),
    )
    expect(result.error).toBeTruthy()
    expect(await answerOf(renewalId, member.id)).toBeNull()
  })

  it('ゲストは対象外で書けない', async () => {
    const { renewalId } = await seedStarted()
    const guest = await createGuest({ name: 'ゲスト' })
    await setAuthSession({ id: guest.id, role: 'guest' })

    const result = await submitRenewalAnswer(
      {},
      formOf({ renewalId: String(renewalId), answer: 'not_register' }),
    )
    expect(result.error).toBeTruthy()
  })

  it('フォームに他人の userId を混ぜても自分の行しか書けない（AC-9）', async () => {
    const { member, other, renewalId } = await seedStarted()
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await submitRenewalAnswer(
      {},
      formOf({
        renewalId: String(renewalId),
        // Action は userId をフォームから読まない（セッションで決める）。
        userId: other.id,
        answer: 'not_register',
      }),
    )
    expect(result.success).toBe(true)
    expect(await answerOf(renewalId, member.id)).toBe('not_register')
    expect(await answerOf(renewalId, other.id)).toBeNull()
  })

  it('「登録する」で必須が欠けていれば欠けた項目が返り、users も書き換わらない', async () => {
    const { member, renewalId } = await seedStarted()
    await testDb.update(users).set({ phone: null }).where(eq(users.id, member.id))
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await submitRenewalAnswer(
      {},
      formOf({
        renewalId: String(renewalId),
        answer: 'register',
        familyName: '北海',
        givenName: '太郎',
        familyKana: 'ほっかい',
        givenKana: 'たろう',
        birthDate: '2004-06-12',
        gender: 'male',
        grade: 'B',
        postalCode: '001-0017',
        address1: '札幌市北区',
        phone: '',
      }),
    )
    expect(result.missingFields).toEqual(['電話番号'])
    expect(await answerOf(renewalId, member.id)).toBeNull()
  })

  it('形式が不正な入力（カタカナのふりがな）は既存の会員編集と同じ文言で拒否する（AC-6）', async () => {
    const { member, renewalId } = await seedStarted()
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await submitRenewalAnswer(
      {},
      formOf({
        renewalId: String(renewalId),
        answer: 'register',
        ...FULL_PROFILE,
        familyKana: 'ホッカイ',
        dan: '',
      }),
    )
    expect(result.error).toContain('ひらがな')
  })

  it('「登録しない」では名簿の列を送っても users を書き換えない', async () => {
    const { member, renewalId } = await seedStarted()
    await setAuthSession({ id: member.id, role: 'member' })

    await submitRenewalAnswer(
      {},
      formOf({
        renewalId: String(renewalId),
        answer: 'not_register',
        address1: '書き換えたい住所',
      }),
    )
    const updated = await testDb.query.users.findFirst({ where: eq(users.id, member.id) })
    expect(updated?.address1).toBe('札幌市北区北17条西3-1-38')
  })
})
