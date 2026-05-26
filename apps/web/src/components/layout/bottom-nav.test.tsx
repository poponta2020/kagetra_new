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

  it('isAdmin=true のとき 5 タブすべてを表示する', () => {
    render(<BottomNav isAdmin />)
    expect(screen.getByText('ホーム')).toBeTruthy()
    expect(screen.getByText('イベント')).toBeTruthy()
    expect(screen.getByText('予定')).toBeTruthy()
    expect(screen.getByText('会員')).toBeTruthy()
    expect(screen.getByText('メール')).toBeTruthy()
  })

  // Regression: non-admins previously saw 会員 tab and were bounced to /403
  // by the admin-only page guard — breaking their bottom-nav UX. メール
  // (mail-inbox) follows the same admin-only convention.
  it('isAdmin=false のとき 会員 / メール タブを表示しない', () => {
    render(<BottomNav isAdmin={false} />)
    expect(screen.getByText('ホーム')).toBeTruthy()
    expect(screen.getByText('イベント')).toBeTruthy()
    expect(screen.getByText('予定')).toBeTruthy()
    expect(screen.queryByText('会員')).toBeNull()
    expect(screen.queryByText('メール')).toBeNull()
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
})
