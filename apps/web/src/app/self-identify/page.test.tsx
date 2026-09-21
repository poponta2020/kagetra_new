import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const { default: SelfIdentifyPage } = await import('./page')

async function renderPage() {
  const ui = await SelfIdentifyPage()
  return render(ui)
}

describe('SelfIdentifyPage', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('lineUserId の無いセッションは /auth/signin へ', async () => {
    await setAuthSession({ id: '', role: 'member', lineUserId: null })
    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT:\/auth\/signin/)
  })

  // AC-15: 既に紐付け済み (session.user.id あり) は / へ。
  it('紐付け済みセッションは / へ', async () => {
    await setAuthSession({ id: 'internal-id', role: 'member', lineUserId: 'Ubound' })
    // アンカー必須: 素の `NEXT_REDIRECT:\/` だと `/auth/signin` にも部分一致してしまう。
    await expect(renderPage()).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })

  it('AC-15: 見出しと送信ボタンが表示される', async () => {
    await createUser({ name: '候補 太郎', isInvited: true, lineUserId: null })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-1' })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'あなたは誰ですか？' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'このメンバーとして続ける' }),
    ).toBeTruthy()
  })

  // AC-15: 候補条件（招待済み・未紐付け・未退会）は変わらない。
  it('AC-15: 招待済み・未紐付け・未退会の会員だけが候補に出る', async () => {
    const eligible = await createUser({
      name: '招待済 花子',
      isInvited: true,
      lineUserId: null,
    })
    const uninvited = await createUser({
      name: '未招待 一郎',
      isInvited: false,
      lineUserId: null,
    })
    const deactivated = await createUser({
      name: '退会済 二郎',
      isInvited: true,
      lineUserId: null,
      deactivatedAt: new Date(),
    })
    const linked = await createUser({
      name: '紐付済 三郎',
      isInvited: true,
      lineUserId: 'Ualready',
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-2' })

    await renderPage()

    // radio の accessible name はラベル内の氏名テキストから来る
    // （RosterClaimForm が `<label>` で input と氏名を包んでいる）。
    expect(screen.getByRole('radio', { name: eligible.name! })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: uninvited.name! })).toBeNull()
    expect(screen.queryByRole('radio', { name: deactivated.name! })).toBeNull()
    expect(screen.queryByRole('radio', { name: linked.name! })).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })

  it('候補0人: 「選択可能な会員がいません」と出て送信ボタンは出ない', async () => {
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-3' })

    await renderPage()

    expect(
      screen.getByText('選択可能な会員がいません。管理者にご連絡ください。'),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'このメンバーとして続ける' }),
    ).toBeNull()
  })

  // roster-claim: 候補は氏名と印（needsPhone/needsBirthDate）だけを持ち、
  // PII そのものはページに出てこない。
  it('候補行の address1・phone・birthDate は画面に一切出ない', async () => {
    await createUser({
      name: '個人情報 花子',
      isInvited: true,
      lineUserId: null,
      address1: '秘密の住所1丁目2番地',
      phone: '090-1234-5678',
      birthDate: '1990-04-01',
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Unew-4' })

    await renderPage()

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('秘密の住所1丁目2番地')
    expect(text).not.toContain('090-1234-5678')
    expect(text).not.toContain('1990-04-01')
  })
})
