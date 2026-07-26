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
    expect(screen.queryByText('予定')).toBeNull()
    // senseki-stats PR-2: 戦績 → 統計 に改称。全ユーザー共有タブ。
    expect(screen.getByText('統計')).toBeTruthy()
    // entry-management: 管理者専用ブロックの先頭（統計の直後・会員の前）に追加。
    expect(screen.getByText('申込管理')).toBeTruthy()
    expect(screen.getByText('会員')).toBeTruthy()
    expect(screen.getByText('メール')).toBeTruthy()
    expect(screen.getByText('Bot')).toBeTruthy()
  })

  // AC-2: 管理者に 7 タブ / 一般会員に 3 タブ（既存 3 つのまま）。
  it('isAdmin=true のとき タブが 7 個ちょうど表示される', () => {
    render(<BottomNav isAdmin />)
    expect(screen.getAllByRole('link')).toHaveLength(7)
  })

  it('isAdmin=false のとき タブが 3 個ちょうど表示される', () => {
    render(<BottomNav isAdmin={false} />)
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  // Regression: non-admins previously saw 会員 tab and were bounced to /403
  // by the admin-only page guard — breaking their bottom-nav UX. メール
  // (mail-inbox) follows the same admin-only convention.
  it('isAdmin=false のとき 共有タブ（統計含む）のみ表示し 会員 / メール は出さない', () => {
    render(<BottomNav isAdmin={false} />)
    expect(screen.getByText('ホーム')).toBeTruthy()
    expect(screen.getByText('イベント')).toBeTruthy()
    expect(screen.queryByText('予定')).toBeNull()
    // senseki-stats PR-2: 統計 は会員でも見える共有タブ。
    expect(screen.getByText('統計')).toBeTruthy()
    // AC-2: 申込管理タブは管理者専用。一般会員には表示されない。
    expect(screen.queryByText('申込管理')).toBeNull()
    expect(screen.queryByText('会員')).toBeNull()
    expect(screen.queryByText('メール')).toBeNull()
  })

  it('pathname=/players で 統計 タブが active になる', () => {
    mockUsePathname.mockReturnValue('/players')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('統計').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/players/42 のような詳細パスでも 統計 タブが active', () => {
    mockUsePathname.mockReturnValue('/players/42')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('統計').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  // senseki-stats PR-2: 統計 タブは /tournaments 配下も active 判定に含む
  // （大会結果・大会統計セクションは /tournaments 基底）。
  it('pathname=/tournaments で 統計 タブが active になる', () => {
    mockUsePathname.mockReturnValue('/tournaments')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('統計').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/tournaments/5 のような大会詳細でも 統計 タブが active', () => {
    mockUsePathname.mockReturnValue('/tournaments/5')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('統計').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/admin/mail-inbox で メール タブが active', () => {
    mockUsePathname.mockReturnValue('/admin/mail-inbox')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('メール').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  // AC-2 / AC-3: entry-management で追加した「申込管理」タブの active 判定と、
  // /admin/entries を開いたとき他タブが誤って光らないことの実効的な検証。
  it('pathname=/admin/entries で 申込管理 タブが active になる', () => {
    mockUsePathname.mockReturnValue('/admin/entries')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('申込管理').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/admin/entries/42 のような詳細パスでも 申込管理 タブが active', () => {
    mockUsePathname.mockReturnValue('/admin/entries/42')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('申込管理').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/admin/entries では 申込管理 以外の 6 タブすべてが active にならない（会員タブへの誤爆を含む）', () => {
    mockUsePathname.mockReturnValue('/admin/entries')
    render(<BottomNav isAdmin />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(7)
    const activeLinks = links.filter((link) =>
      link.className.includes('border-brand'),
    )
    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0]?.textContent).toBe('申込管理')
    expect(screen.getByText('会員').closest('a')?.className).not.toContain(
      'border-brand',
    )
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

  // AC-3（回帰）: entry-management のタブ追加で既存 6 タブの id・ラベル・href
  // が変わっていないことを確認する。id は DOM に出ないため、ラベルと href の
  // 対応で代替検証する。
  it('既存 6 タブのラベルと href の対応が変わっていない（回帰）', () => {
    render(<BottomNav isAdmin />)
    const expected: ReadonlyArray<[string, string]> = [
      ['ホーム', '/dashboard'],
      ['イベント', '/events'],
      ['統計', '/players'],
      ['会員', '/admin/members'],
      ['メール', '/admin/mail-inbox'],
      ['Bot', '/admin/line-channels'],
    ]
    for (const [label, href] of expected) {
      const link = screen.getByText(label).closest('a')
      expect(link?.getAttribute('href')).toBe(href)
    }
  })

  it('申込管理 タブの href は /admin/entries', () => {
    render(<BottomNav isAdmin />)
    const link = screen.getByText('申込管理').closest('a')
    expect(link?.getAttribute('href')).toBe('/admin/entries')
  })
})
