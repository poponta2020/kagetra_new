import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { registrationInvites } from '@kagetra/shared/schema'
import type { RosterCandidate } from '@/lib/roster-claim-input'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const { default: RegisterPage } = await import('./page')
const { MemberRegisterEntry } = await import('./member-register-entry')

const DAY_MS = 24 * 60 * 60 * 1000

async function seedInvite(
  createdBy: string,
  opts?: { token?: string; expiresAt?: Date; revokedAt?: Date | null; kind?: 'member' | 'guest' },
): Promise<string> {
  const token = opts?.token ?? `valid-token-${crypto.randomUUID()}`
  await testDb.insert(registrationInvites).values({
    token,
    kind: opts?.kind ?? 'member',
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
    createdBy,
    revokedAt: opts?.revokedAt ?? null,
  })
  return token
}

async function renderPage(token: string) {
  const ui = await RegisterPage({ params: Promise.resolve({ token }) })
  return { ui, ...render(ui) }
}

// ページが返す React 要素ツリーを再帰的にたどって、指定した type の要素を探す
// （AC-2: MemberRegisterEntry の props に PII が漏れていないことを、DOM に
// 描画する前の要素ツリーの時点で確認するため）。
function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found) return found
    }
    return null
  }
  const el = node as ReactElement<{ children?: ReactNode }>
  if (el.type === type) return el
  return findElement(el.props?.children ?? null, type)
}

describe('RegisterPage', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('会員用・候補1人以上: 「名簿から選ぶ／新しく登録する」の2択が出て、選ぶまでフォームは出ない（AC-1）', async () => {
    const issuer = await createUser({ name: 'issuer-page-1', role: 'admin', lineUserId: 'Uissuer-page-1' })
    const token = await seedInvite(issuer.id)
    await createUser({ name: '候補 花子', lineUserId: null, isInvited: true })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Upage-1' })

    await renderPage(token)

    expect(screen.getByRole('radio', { name: '名簿から選ぶ' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '新しく登録する' })).toBeTruthy()
    expect(screen.queryByLabelText('姓（漢字）')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: '名簿から選ぶ' }))
    expect(screen.getByText('候補 花子')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'このお名前で登録する' })).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '新しく登録する' }))
    expect(screen.getByLabelText('姓（漢字）')).toBeTruthy()
  })

  it('会員用・候補0人: 「姓（漢字）」欄が最初から出て、「名簿から選ぶ」は出ない（AC-1）', async () => {
    const issuer = await createUser({ name: 'issuer-page-2', role: 'admin', lineUserId: 'Uissuer-page-2' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Upage-2' })

    await renderPage(token)

    expect(screen.getByLabelText('姓（漢字）')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '名簿から選ぶ' })).toBeNull()
  })

  it('AC-2: 名簿候補の PII（住所・電話・生年月日・郵便番号）はページ生成物にもDOMにも露出しない', async () => {
    const issuer = await createUser({ name: 'issuer-page-3', role: 'admin', lineUserId: 'Uissuer-page-3' })
    const token = await seedInvite(issuer.id)
    await createUser({
      name: '候補 三郎',
      lineUserId: null,
      isInvited: true,
      grade: 'B',
      address1: '札幌市テスト区1-2-3',
      phone: '090-5555-6666',
      birthDate: '1991-02-03',
      postalCode: '0600000',
    })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Upage-3' })

    const ui = await RegisterPage({ params: Promise.resolve({ token }) })
    const entry = findElement(ui, MemberRegisterEntry)
    expect(entry).toBeTruthy()
    const candidates = (entry!.props as { candidates: RosterCandidate[] }).candidates
    expect(candidates.length).toBeGreaterThan(0)
    for (const c of candidates) {
      expect(Object.keys(c).sort()).toEqual(['id', 'name', 'needsBirthDate', 'needsPhone'])
    }
    const json = JSON.stringify(candidates)
    expect(json).not.toContain('札幌市テスト区')
    expect(json).not.toContain('090-5555-6666')
    expect(json).not.toContain('1991-02-03')
    expect(json).not.toContain('0600000')

    render(ui)
    fireEvent.click(screen.getByRole('radio', { name: '名簿から選ぶ' }))
    // 一覧が実際に描画されたことを確認してから漏洩チェックする（空DOMでの空振り防止）。
    expect(screen.getByText('候補 三郎')).toBeTruthy()
    expect(document.body.textContent).not.toContain('札幌市テスト区')
    expect(document.body.textContent).not.toContain('090-5555-6666')
    expect(document.body.textContent).not.toContain('1991-02-03')
    expect(document.body.textContent).not.toContain('0600000')
  })

  it('AC-13: ゲスト用トークン・候補ありでも「表示名」欄がそのまま出て、「名簿から選ぶ」は出ない', async () => {
    const issuer = await createUser({ name: 'issuer-page-4', role: 'admin', lineUserId: 'Uissuer-page-4' })
    const token = await seedInvite(issuer.id, { kind: 'guest', token: 'guest-page-token' })
    await createUser({ name: '候補 四郎', lineUserId: null, isInvited: true })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Upage-4' })

    await renderPage(token)

    expect(screen.getByLabelText('表示名')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '名簿から選ぶ' })).toBeNull()
  })

  it('AC-15: 存在しないトークンは無効メッセージを表示する', async () => {
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Upage-5' })

    await renderPage('no-such-token')

    expect(
      screen.getByText('この招待リンクは無効か期限切れです。お手数ですが管理者にご連絡ください。'),
    ).toBeTruthy()
  })

  it('AC-15: 期限切れトークンは無効メッセージを表示する', async () => {
    const issuer = await createUser({ name: 'issuer-page-6', role: 'admin', lineUserId: 'Uissuer-page-6' })
    const token = await seedInvite(issuer.id, { expiresAt: new Date(Date.now() - DAY_MS) })
    await setAuthSession({ id: '', role: 'member', lineUserId: 'Upage-6' })

    await renderPage(token)

    expect(
      screen.getByText('この招待リンクは無効か期限切れです。お手数ですが管理者にご連絡ください。'),
    ).toBeTruthy()
  })

  it('AC-15: 紐付け済みセッションは / へ reject する', async () => {
    const issuer = await createUser({ name: 'issuer-page-7', role: 'admin', lineUserId: 'Uissuer-page-7' })
    const token = await seedInvite(issuer.id)
    await setAuthSession({ id: 'bound-id', role: 'member', lineUserId: 'Upage-7' })

    await expect(renderPage(token)).rejects.toThrow(/NEXT_REDIRECT:\//)
  })

  it('AC-15: 未ログインは「LINE で認証する」ボタンが出る', async () => {
    const issuer = await createUser({ name: 'issuer-page-8', role: 'admin', lineUserId: 'Uissuer-page-8' })
    const token = await seedInvite(issuer.id)
    await setAuthSession(null)

    await renderPage(token)

    expect(screen.getByRole('button', { name: 'LINE で認証する' })).toBeTruthy()
  })
})
