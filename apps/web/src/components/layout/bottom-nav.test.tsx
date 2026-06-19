import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BottomNav } from './bottom-nav'

const mockUsePathname = vi.fn<() => string | null>()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

describe('BottomNav', () => {
  beforeEach(() => {
    mockUsePathname.mockReset()
    mockUsePathname.mockReturnValue('/dashboard')
  })

  it('isAdmin=true のとき 全タブ（共有 + 管理者）を表示する', () => {
    render(<BottomNav isAdmin />)
    expect(screen.getByText('ホーム')).toBeTruthy()
    expect(screen.getByText('イベント')).toBeTruthy()
    expect(screen.getByText('予定')).toBeTruthy()
    // tournament-results Task5: 戦績 は全ユーザー共有タブ。
    expect(screen.getByText('戦績')).toBeTruthy()
    expect(screen.getByText('会員')).toBeTruthy()
    expect(screen.getByText('メール')).toBeTruthy()
    expect(screen.getByText('Bot')).toBeTruthy()
  })

  // Regression: non-admins previously saw 会員 tab and were bounced to /403
  // by the admin-only page guard — breaking their bottom-nav UX. メール
  // (mail-inbox) follows the same admin-only convention.
  it('isAdmin=false のとき 共有タブ（戦績含む）のみ表示し 会員 / メール は出さない', () => {
    render(<BottomNav isAdmin={false} />)
    expect(screen.getByText('ホーム')).toBeTruthy()
    expect(screen.getByText('イベント')).toBeTruthy()
    expect(screen.getByText('予定')).toBeTruthy()
    // tournament-results Task5: 戦績 は会員でも見える初の専用タブ。
    expect(screen.getByText('戦績')).toBeTruthy()
    expect(screen.queryByText('会員')).toBeNull()
    expect(screen.queryByText('メール')).toBeNull()
  })

  it('pathname=/players で 戦績 タブが active になる', () => {
    mockUsePathname.mockReturnValue('/players')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('戦績').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/players/42 のような詳細パスでも 戦績 タブが active', () => {
    mockUsePathname.mockReturnValue('/players/42')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('戦績').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/admin/mail-inbox で メール タブが active', () => {
    mockUsePathname.mockReturnValue('/admin/mail-inbox')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('メール').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/events で イベント タブが active になる', () => {
    mockUsePathname.mockReturnValue('/events')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('イベント').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/events/123 のような詳細パスでも イベント タブが active', () => {
    mockUsePathname.mockReturnValue('/events/123')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('イベント').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  // Regression: `startsWith('/events')` previously matched `/events-archive`
  // and lit up the wrong tab. Segment-boundary matching fixes this.
  it('pathname=/events-archive では イベント タブが active にならない', () => {
    mockUsePathname.mockReturnValue('/events-archive')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('イベント').closest('a')
    expect(link?.className).not.toContain('border-brand')
    expect(link?.className).toContain('border-transparent')
  })

  it('pathname=/members で 会員 タブが active (isAdmin=true)', () => {
    mockUsePathname.mockReturnValue('/members')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('会員').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/admin/members/42/edit でも 会員 タブが active', () => {
    mockUsePathname.mockReturnValue('/admin/members/42/edit')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('会員').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  // sticky-mobile-shell: ensure the iOS home-indicator area gets bg-surface
  // by extending the <nav> via padding-bottom; without env(safe-area-inset-
  // bottom) the home indicator overlaps the bottom tab row. Implemented as a
  // Tailwind arbitrary value (not inline style) so jsdom — which silently
  // drops `env()` when round-tripping inline styles through the CSSOM — can
  // still verify the intent at the class-name level.
  it('<nav> に safe-area の padding-bottom が arbitrary value で適用される', () => {
    render(<BottomNav isAdmin />)
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]')
  })

  // Regression guard for the iPhone home-indicator clipping bug (PR #67):
  // Tailwind's default box-sizing: border-box meant `min-h-[52px]` plus
  // `pb-[env(safe-area-inset-bottom)]` (~34px) collapsed the content area
  // to ~18px, letting the 52px <Link> children overflow off-screen. The
  // min-h MUST be `calc(52px + env(safe-area-inset-bottom))` so the
  // content area stays a full 52px after the safe-area padding is removed.
  it('<nav> の min-height が calc(52px + safe-area) で確保される', () => {
    render(<BottomNav isAdmin />)
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain(
      'min-h-[calc(52px_+_env(safe-area-inset-bottom))]',
    )
    // Plain `min-h-[52px]` reintroduces the clipping bug — guard against
    // an accidental revert.
    expect(nav.className).not.toMatch(/(?<!\+)min-h-\[52px\]/)
  })
})
