import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import type { MailSearchRow } from '@/lib/member-mail/search'
import type { HistoryRow } from '@/lib/mail-history'

/**
 * member-mail-search タスク4: `/mail` 一覧ページ（requirements.md §3.1 S1・§3.3・§3.5b）。
 *
 * `admin/mail-inbox/page.test.tsx` と同じモックの張り方（`next/navigation` の
 * `redirect` を throw させて短絡させる）を踏襲しつつ、DB を直接叩かず
 * `@/lib/member-mail/search` / `@/lib/mail-history.queries` をモックする
 * （このページ自身のロジック＝認可・searchParams の受け渡し・表示分岐だけを見るため。
 * クエリ層とロジック層は `search.test.ts` / `mail-history.test.ts` が別に持つ）。
 */

// `useRouter` は検索バー（client component）が使う。ページを render すると
// 子として実際にマウントされるので、mock に含めないと "No useRouter export" で
// 全ケースが落ちる。
const routerPushMock = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/auth', () => mockAuthModule())

const searchMemberMailsMock = vi.fn()
vi.mock('@/lib/member-mail/search', () => ({
  searchMemberMails: (...args: unknown[]) => searchMemberMailsMock(...args),
}))

const loadHistoriesMock = vi.fn()
vi.mock('@/lib/mail-history.queries', () => ({
  loadHistories: (...args: unknown[]) => loadHistoriesMock(...args),
}))

// page.tsx は db インスタンスを loadHistories へ渡すだけで、DB へは直接触れない。
vi.mock('@/lib/db', () => ({ db: {} }))

const { default: MailPage } = await import('./page')

function makeRow(overrides: Partial<MailSearchRow> = {}): MailSearchRow {
  return {
    id: 1,
    subject: 'テストメール件名',
    fromName: 'テスト太郎',
    fromAddress: 'test@example.jp',
    receivedAt: new Date('2026-08-08T07:25:00Z'),
    triageStatus: 'processed',
    mailKind: null,
    attachments: [],
    subjectMatched: false,
    excerpt: null,
    ...overrides,
  }
}

async function renderPage(searchParams: { q?: string; att?: string } = {}) {
  const ui = await MailPage({ searchParams: Promise.resolve(searchParams) })
  return render(ui)
}

describe('/mail 一覧ページ', () => {
  beforeEach(() => {
    searchMemberMailsMock.mockReset()
    loadHistoriesMock.mockReset()
    searchMemberMailsMock.mockResolvedValue({ rows: [], total: 0 })
    loadHistoriesMock.mockResolvedValue(new Map<number, HistoryRow[]>())
  })

  it('AC-2: role=member のセッションで一覧が描画される（403 にならない・redirect が呼ばれない）', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    searchMemberMailsMock.mockResolvedValue({ rows: [makeRow()], total: 1 })

    await renderPage()

    expect(screen.getByText('テストメール件名')).toBeTruthy()
    const { redirect } = (await import('next/navigation')) as unknown as {
      redirect: ReturnType<typeof vi.fn>
    }
    expect(redirect).not.toHaveBeenCalled()
  })

  it('未ログインで /auth/signin へ redirect される', async () => {
    await setAuthSession(null)

    await expect(MailPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/auth/signin',
    )
  })

  it('AC-6/AC-7: q と att が searchMemberMails の引数に反映される', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })

    await renderPage({ q: '多摩大会', att: '1' })

    expect(searchMemberMailsMock).toHaveBeenCalledWith({
      q: '多摩大会',
      attachmentsOnly: true,
      limit: 20,
      offset: 0,
    })
  })

  it('q・att 未指定は絞り込みなし（attachmentsOnly=false・q=""）で呼ばれる', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })

    await renderPage()

    expect(searchMemberMailsMock).toHaveBeenCalledWith({
      q: '',
      attachmentsOnly: false,
      limit: 20,
      offset: 0,
    })
  })

  it('AC-9/AC-10: classification=noise 相当・未処理の行が描画され、未処理ピルが付く', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    searchMemberMailsMock.mockResolvedValue({
      rows: [
        makeRow({
          id: 2,
          subject: 'ノイズ相当だが会員に有用な連絡',
          triageStatus: 'unprocessed',
        }),
      ],
      total: 1,
    })

    await renderPage()

    expect(screen.getByText('ノイズ相当だが会員に有用な連絡')).toBeTruthy()
    expect(screen.getByText('未処理')).toBeTruthy()
  })

  it('検索0件・att 無効時は「外す」提案を出さない', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    searchMemberMailsMock.mockResolvedValue({ rows: [], total: 0 })

    await renderPage({ q: '該当なし' })

    expect(screen.getByText('該当するメールがありません')).toBeTruthy()
    expect(screen.queryByText(/添付ありのみ」を外してみてください/)).toBeNull()
  })

  it('検索0件・att 有効時は「外す」提案を出す', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    searchMemberMailsMock.mockResolvedValue({ rows: [], total: 0 })

    await renderPage({ q: '該当なし', att: '1' })

    expect(screen.getByText('該当するメールがありません')).toBeTruthy()
    expect(screen.getByText(/添付ありのみ」を外してみてください/)).toBeTruthy()
  })
})
