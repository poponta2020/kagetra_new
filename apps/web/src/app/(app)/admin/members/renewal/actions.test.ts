import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  membershipRenewalMembers,
  membershipRenewals,
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const {
  startRenewalAction,
  proxyAnswerAction,
  changeDeadlineAction,
  completeRenewalAction,
} = await import('./actions')

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

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

async function seedClubLineGroup() {
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
}

/** 未来の日付（テストの実行日に依存しないよう +30 日）。 */
function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

describe('startRenewalAction', () => {
  it('管理者が開始でき、対象者と案内タスクが作られる', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    await createUser({ name: '対象者', ...FULL_PROFILE })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await startRenewalAction(
      {},
      formOf({ fiscalYear: '2099', deadline: futureDate(15), note: '一言' }),
    )
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(await testDb.select().from(membershipRenewals)).toHaveLength(1)
  })

  it('副管理者も開始できる', async () => {
    await seedClubLineGroup()
    const vice = await createViceAdmin({ name: 'vice' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    const result = await startRenewalAction(
      {},
      formOf({ fiscalYear: '2099', deadline: futureDate(15), note: '' }),
    )
    expect(result.success).toBe(true)
  })

  it('一般会員・未認証は拒否され、行も作られない（R12）', async () => {
    await seedClubLineGroup()
    const member = await createUser({ name: '会員' })

    await setAuthSession({ id: member.id, role: 'member' })
    expect(
      (await startRenewalAction({}, formOf({ fiscalYear: '2099', deadline: futureDate(15) })))
        .error,
    ).toBeTruthy()

    await setAuthSession(null)
    expect(
      (await startRenewalAction({}, formOf({ fiscalYear: '2099', deadline: futureDate(15) })))
        .error,
    ).toBeTruthy()

    expect(await testDb.select().from(membershipRenewals)).toHaveLength(0)
  })
})

describe('proxyAnswerAction / changeDeadlineAction / completeRenewalAction', () => {
  async function started() {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const target = await createUser({ name: '対象者', ...FULL_PROFILE, lineUserId: null })
    await setAuthSession({ id: admin.id, role: 'admin' })
    await startRenewalAction(
      {},
      formOf({ fiscalYear: '2099', deadline: futureDate(15), note: '' }),
    )
    const [renewal] = await testDb.select().from(membershipRenewals)
    return { admin, target, renewalId: renewal!.id }
  }

  it('代理回答が管理者の回答として記録される（AC-14。LINE 未紐付けでも可）', async () => {
    const { target, renewalId } = await started()

    const result = await proxyAnswerAction(
      {},
      formOf({ renewalId: String(renewalId), userId: target.id, answer: 'not_register' }),
    )
    expect(result.success).toBe(true)

    const [row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.userId, target.id))
    expect(row!.answer).toBe('not_register')
    expect(row!.answeredByAdmin).toBe(true)
  })

  it('一般会員は代理回答できない', async () => {
    const { target, renewalId } = await started()
    const member = await createUser({ name: '別の会員' })
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await proxyAnswerAction(
      {},
      formOf({ renewalId: String(renewalId), userId: target.id, answer: 'not_register' }),
    )
    expect(result.error).toBeTruthy()

    const [row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.userId, target.id))
    expect(row!.answer).toBeNull()
  })

  it('締切を変更できる。過去日は拒否する', async () => {
    const { renewalId } = await started()

    const ok = await changeDeadlineAction(
      {},
      formOf({ renewalId: String(renewalId), deadline: futureDate(20) }),
    )
    expect(ok.success).toBe(true)
    const [renewal] = await testDb.select().from(membershipRenewals)
    expect(renewal!.deadline).toBe(futureDate(20))

    const ng = await changeDeadlineAction(
      {},
      formOf({ renewalId: String(renewalId), deadline: futureDate(-1) }),
    )
    expect(ng.error).toBeTruthy()
  })

  it('登録完了で「登録しない」のフラグが落ち、完了状態になる（AC-18）', async () => {
    const { target, renewalId } = await started()
    await proxyAnswerAction(
      {},
      formOf({ renewalId: String(renewalId), userId: target.id, answer: 'not_register' }),
    )

    const result = await completeRenewalAction({}, formOf({ renewalId: String(renewalId) }))
    expect(result.success).toBe(true)

    const updated = await testDb.query.users.findFirst({ where: eq(users.id, target.id) })
    expect(updated?.zenNichikyo).toBe(false)
    const [renewal] = await testDb.select().from(membershipRenewals)
    expect(renewal!.status).toBe('completed')
  })

  it('一般会員は登録完了できない', async () => {
    const { renewalId } = await started()
    const member = await createUser({ name: '別の会員' })
    await setAuthSession({ id: member.id, role: 'member' })

    const result = await completeRenewalAction({}, formOf({ renewalId: String(renewalId) }))
    expect(result.error).toBeTruthy()
    const [renewal] = await testDb.select().from(membershipRenewals)
    expect(renewal!.status).toBe('open')
  })
})
