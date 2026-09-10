import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { clubLineGroups, lineChannels, membershipRenewals } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * annual-registration-renewal タスク9: S2 `/admin/members/renewal` の3状態
 * （未開始／進行中／完了後）と到達権限（AC-13・AC-19・R12）。
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { default: RenewalAdminPage } = await import('./page')
const { completeRenewalAction, startRenewalAction } = await import('./actions')

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

function renderPage(view?: string) {
  return RenewalAdminPage({ searchParams: Promise.resolve(view ? { view } : {}) })
}

function formOf(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
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

async function startAndCompleteRenewal(): Promise<void> {
  await seedClubLineGroup()
  const admin = await createAdmin({ name: '起動管理者' })
  await createUser({ name: '対象者一', zenNichikyo: true })
  await setAuthSession({ id: admin.id, role: 'admin' })
  await startRenewalAction({}, formOf({ fiscalYear: '2099', deadline: futureDate(15), note: '' }))
  const [renewal] = await testDb.select().from(membershipRenewals)
  await completeRenewalAction({}, formOf({ renewalId: String(renewal!.id) }))
}

beforeEach(async () => {
  await truncateAll()
  process.env.PUBLIC_BASE_URL = 'https://example.test'
})

afterAll(async () => {
  await closeTestDb()
  if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
})

describe('到達権限 (R12)', () => {
  it('管理者・副管理者は描画される', async () => {
    for (const create of [createAdmin, createViceAdmin]) {
      const user = await create()
      await setAuthSession({ id: user.id, role: user.role as 'admin' | 'vice_admin' })
      const ui = await renderPage()
      expect(ui).toBeTruthy()
    }
  })

  it('一般会員・ゲストは /403 へリダイレクトされる', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/403')

    const guest = await createGuest()
    await setAuthSession({ id: guest.id, role: 'guest' })
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/403')
  })

  it('未ログインは /auth/signin へリダイレクトされる', async () => {
    await setAuthSession(null)
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/auth/signin')
  })
})

describe('3状態', () => {
  it('未開始: 開始フォームが出る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    render(await renderPage())

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('年度確認')
    expect(screen.getByRole('button', { name: /開始して案内を送る/ })).toBeTruthy()
  })

  it('進行中: ボードが出る（代理回答・締切変更・登録完了あり）', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin()
    await createUser({ name: '対象者一', zenNichikyo: true })
    await setAuthSession({ id: admin.id, role: 'admin' })
    await startRenewalAction({}, formOf({ fiscalYear: '2099', deadline: futureDate(15), note: '' }))

    render(await renderPage())

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('2099年度 登録確認')
    expect(screen.getByRole('button', { name: '登録完了にする' })).toBeTruthy()
    expect(screen.getByText('締切を変更')).toBeTruthy()
  })

  it('完了後（?view=result）: 読み取り専用のボードが出る', async () => {
    await startAndCompleteRenewal()
    const admin = await createAdmin({ name: '閲覧管理者' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    render(await renderPage('result'))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('2099年度 登録確認')
    expect(screen.queryByRole('button', { name: '登録完了にする' })).toBeNull()
    expect(screen.queryByText('締切を変更')).toBeNull()
  })

  it('完了後だが ?view=result を指定しなければ未開始（前回情報つき）が出る', async () => {
    await startAndCompleteRenewal()
    const admin = await createAdmin({ name: '次年度管理者' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    render(await renderPage())

    expect(screen.getByRole('button', { name: /開始して案内を送る/ })).toBeTruthy()
    expect(screen.getByText(/前回: 2099年度/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '結果を見る' })).toBeTruthy()
  })
})
