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
})
