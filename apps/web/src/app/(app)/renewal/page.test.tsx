import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { clubLineGroups, lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { startRenewal } from '@/lib/membership-renewal/store'

/**
 * annual-registration-renewal タスク6: S1 `/renewal` の到達権限と
 * セクションの出し分け（R12・AC-9・AC-10）。
 *
 * 表示の細部（行内修正・必須欠落でボタン無効・最終学年の3択）は
 * `RenewalForm.test.tsx`（DB 非依存）の担当。ここは RSC 側の
 * 「誰に何を出すか」だけを見る。
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { default: RenewalPage } = await import('./page')

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

const CIRCLE_PROFILE = {
  isCircleMember: true,
  facultyKind: 'undergraduate' as const,
  faculty: '工学部',
  schoolYear: '2年',
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

/** 対象者を作ってから年度確認を開始する。 */
async function startWith(profile: Record<string, unknown>) {
  await seedClubLineGroup()
  const admin = await createAdmin({ name: 'admin' })
  const member = await createUser({ name: '北海 太郎', ...profile })
  await startRenewal(
    { fiscalYear: 2099, deadline: '2099-03-25', note: null },
    admin.id,
    new Date('2099-03-10T03:00:00Z'),
  )
  return member
}

async function renderPage() {
  render(await RenewalPage())
}

describe('/renewal の到達権限', () => {
  it('未ログインは /403 へ飛ばす', async () => {
    await setAuthSession(null)
    await expect(RenewalPage()).rejects.toThrow('NEXT_REDIRECT:/403')
  })

  it('ゲストは /403 へ飛ばす（年度確認の対象外）', async () => {
    const guest = await createGuest({ name: 'ゲスト' })
    await setAuthSession({ id: guest.id, role: 'guest' })
    await expect(RenewalPage()).rejects.toThrow('NEXT_REDIRECT:/403')
  })
})

describe('/renewal のセクション出し分け（AC-10）', () => {
  it('両方の対象なら 全日協 と 4月からの学年 の両方を出す', async () => {
    const member = await startWith({ ...FULL_PROFILE, ...CIRCLE_PROFILE })
    await setAuthSession({ id: member.id, role: 'member' })

    await renderPage()
    expect(screen.getByRole('heading', { name: '全日協の登録' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '4月からの学年' })).toBeTruthy()
  })

  it('全日協だけの対象なら学年セクションを出さない', async () => {
    const member = await startWith(FULL_PROFILE)
    await setAuthSession({ id: member.id, role: 'member' })

    await renderPage()
    expect(screen.getByRole('heading', { name: '全日協の登録' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '4月からの学年' })).toBeNull()
  })

  it('サークルだけの対象なら全日協セクションを出さない', async () => {
    const member = await startWith(CIRCLE_PROFILE)
    await setAuthSession({ id: member.id, role: 'member' })

    await renderPage()
    expect(screen.queryByRole('heading', { name: '全日協の登録' })).toBeNull()
    expect(screen.getByRole('heading', { name: '4月からの学年' })).toBeTruthy()
  })

  it('対象外の会員には「対象ではありません」だけを出す（AC-9・AC-10）', async () => {
    await startWith(FULL_PROFILE)
    const outsider = await createUser({ name: '対象外' })
    await setAuthSession({ id: outsider.id, role: 'member' })

    await renderPage()
    expect(screen.getByText(/対象ではありません/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '全日協の登録' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '4月からの学年' })).toBeNull()
  })

  it('進行中の年度確認が無ければ「対象ではありません」だけを出す', async () => {
    const member = await createUser({ name: '会員', ...FULL_PROFILE })
    await setAuthSession({ id: member.id, role: 'member' })

    await renderPage()
    expect(screen.getByText(/対象ではありません/)).toBeTruthy()
  })
})
