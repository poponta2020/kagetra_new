import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createMailMessage,
  createTournamentDraft,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// Mirrors [id]/page.test.tsx — `notFound` / `redirect` rethrow so the page
// short-circuits cleanly under jsdom. The list page only redirects on
// non-admin sessions and tests always set admin, so neither should fire.
// `useRouter` is also stubbed because TriggerFetchButton (Client Component
// rendered inside the list page) calls it during render under jsdom.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: MailInboxPage } = await import('./page')

async function renderPage() {
  const ui = await MailInboxPage()
  return render(ui)
}

describe('admin/mail-inbox list page', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('DraftCard が詳細ページへのリンクで wrap されている', async () => {
    // worklog 2026-05-09 で発見したリグレッション: 一覧 Card が href を
    // 持たず、URL 直打ち以外では詳細ページに辿り着けなかった。Link wiring
    // が壊れると承認フローへの入口が消えるので href の値まで固定する。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'list link wiring test' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
    })

    await renderPage()

    // Anchor by the status pill text, then walk up to the enclosing <a>.
    const statusPill = screen.getByText('承認待ち')
    const anchor = statusPill.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(
      `/admin/mail-inbox/${draft.id}`,
    )
  })

  it('行が conf と status に基づく 3 階層 section に振り分けられる', async () => {
    // PR #24 の効果計測で pending_review が 17 → 35 に倍増し、conf 0.97 /
    // 0.82 / 0.72 がフラットな受信時刻ソートに紛れていた。優先 bucket を
    // 入れて (要対応 = conf >= 0.9、要確認 = pending かつ低 conf、その他 =
    // pending 以外) admin の処理 throughput を上げる。section の見出しは
    // 件数 (N) 付きで上から (要対応 → 要確認 → その他) の順に並ぶ。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const highMail = await createMailMessage({ subject: 'HIGH_CONF_TOURNAMENT' })
    await createTournamentDraft({
      messageId: highMail.id,
      status: 'pending_review',
      confidence: '0.97',
    })
    const midMail = await createMailMessage({ subject: 'MID_CONF_TOURNAMENT' })
    await createTournamentDraft({
      messageId: midMail.id,
      status: 'pending_review',
      confidence: '0.72',
    })
    const approvedMail = await createMailMessage({
      subject: 'APPROVED_REFERENCE',
    })
    await createTournamentDraft({
      messageId: approvedMail.id,
      status: 'approved',
      confidence: '0.95',
    })
    const noDraftMail = await createMailMessage({
      subject: 'NOISE_NO_DRAFT',
      status: 'ai_done',
      classification: 'noise',
    })

    await renderPage()

    // Section の登場順を見出し位置で確認。
    const headings = ['要対応', '要確認', 'その他'].map(
      (label) => screen.getByText(new RegExp(`^${label} \\(\\d+\\)$`)),
    )
    expect(headings[0]?.textContent).toBe('要対応 (1)')
    expect(headings[1]?.textContent).toBe('要確認 (1)')
    expect(headings[2]?.textContent).toBe('その他 (2)') // approved + no-draft

    // 上から 要対応 → 要確認 → その他 の順で DOM に登場する。
    const pos = (el: HTMLElement) =>
      Array.from(document.body.querySelectorAll<HTMLElement>('h2')).indexOf(el)
    expect(pos(headings[0]!)).toBeGreaterThanOrEqual(0)
    expect(pos(headings[1]!)).toBeGreaterThan(pos(headings[0]!))
    expect(pos(headings[2]!)).toBeGreaterThan(pos(headings[1]!))

    // HIGH_CONF が要対応 section に、MID_CONF が要確認 section に入る。
    // 件名 → 親 section をたどって見出しテキストを照合。
    const sectionOf = (subject: string) => {
      const el = screen.getByText(subject)
      const section = el.closest('section')
      return section?.querySelector('h2')?.textContent ?? null
    }
    expect(sectionOf('HIGH_CONF_TOURNAMENT')).toBe('要対応 (1)')
    expect(sectionOf('MID_CONF_TOURNAMENT')).toBe('要確認 (1)')
    expect(sectionOf('APPROVED_REFERENCE')).toBe('その他 (2)')
    expect(sectionOf('NOISE_NO_DRAFT')).toBe('その他 (2)')
  })

  it('空の section は描画されない (要確認 が 0 件のケース)', async () => {
    // 空 section が見出しだけ残ると admin が「あと N 件未確認?」と
    // 誤読する。要対応のみ 1 件のとき "要確認" 見出しが消えていることを
    // 確認 (要対応 1 件、要確認 0 件、その他 0 件 → section は 1 つだけ)。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const highMail = await createMailMessage({ subject: 'only high conf' })
    await createTournamentDraft({
      messageId: highMail.id,
      status: 'pending_review',
      confidence: '0.95',
    })

    await renderPage()

    expect(screen.queryByText(/^要対応 \(1\)$/)).not.toBeNull()
    expect(screen.queryByText(/^要確認 /)).toBeNull()
    expect(screen.queryByText(/^その他 /)).toBeNull()
  })

  it('要対応 section の card に brand accent class が乗る', async () => {
    // 高優先 (要対応) の Card は border-l-4 border-l-brand で視覚的強調する。
    // Card は className を最後に append する (cn merge) ので、accent class
    // の出現で要対応 bucket に振り分けられていることを保証する。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const highMail = await createMailMessage({ subject: 'high conf accent test' })
    await createTournamentDraft({
      messageId: highMail.id,
      status: 'pending_review',
      confidence: '0.97',
    })

    await renderPage()

    const subj = screen.getByText('high conf accent test')
    // Card のルート div は subject の祖先で border-l-brand を持つはず。
    const card = subj.closest('[class*="border-l-brand"]')
    expect(card).not.toBeNull()
  })
})
