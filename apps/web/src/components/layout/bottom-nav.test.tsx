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

  // AC-27 / AC-27b（member-mail-search）: 「メール」を一般会員へ開放したので
  // 一般会員も 6 タブちょうど、かつこの並び順（設定タブは常に最後尾）。
  // 他タブの表示・並びは開放前から変わっていない＝この配列がその回帰ガード。
  it('isAdmin=false のとき ホーム/大会/申込管理/統計/メール/設定 の 6 タブが、この順序ちょうどで表示される', () => {
    render(<BottomNav isAdmin={false} />)
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'ホーム',
      '大会',
      '申込管理',
      '統計',
      'メール',
      '設定',
    ])
  })

  // AC-27: 一般会員のメールタブは会員向けの読み取り専用画面 `/mail` を指す。
  it('isAdmin=false のとき メール タブが表示され href が /mail', () => {
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('メール').closest('a')
    expect(link?.getAttribute('href')).toBe('/mail')
  })

  // AC-27b: 管理者は従来どおり管理者受信箱へ。
  it('isAdmin=true のとき メール タブの href は /admin/mail-inbox のまま', () => {
    render(<BottomNav isAdmin />)
    const link = screen.getByText('メール').closest('a')
    expect(link?.getAttribute('href')).toBe('/admin/mail-inbox')
  })

  // `isAdmin` は `session.user.role`（＝実効ロール）由来なので、管理者が
  // 一般会員プレビュー中は会員と同じ `/mail` を指すのが正しい（開放前は
  // adminOnly でタブごと消えていた）。
  it('role-preview 中（isAdmin=false + previewRoleLabel）でもメールタブが出て href が /mail', () => {
    render(<BottomNav isAdmin={false} previewRoleLabel="一般会員" />)
    const link = screen.getByText('メール').closest('a')
    expect(link?.getAttribute('href')).toBe('/mail')
  })

  it.each(['/mail', '/mail/12', '/mail/attachments/34'])(
    'pathname=%s で メール タブが active になる（一般会員）',
    (pathname) => {
      mockUsePathname.mockReturnValue(pathname)
      render(<BottomNav isAdmin={false} />)
      const link = screen.getByText('メール').closest('a')
      expect(link?.className).toContain('border-brand')
    },
  )

  // AC-5 / AC-6: 管理者は ホーム/大会/申込管理/統計/メール/設定 の
  // 6 タブちょうど（会員・Bot の独立タブは無い）、かつこの並び順。
  it('isAdmin=true のとき ホーム/大会/申込管理/統計/メール/設定 の 6 タブが、この順序ちょうどで表示される', () => {
    render(<BottomNav isAdmin />)
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'ホーム',
      '大会',
      '申込管理',
      '統計',
      'メール',
      '設定',
    ])
  })

  // nav-settings-hub: 会員 (`/admin/members`) と Bot (`/admin/line-channels`)
  // は独立タブを廃止し、設定ハブ経由の導線に一本化した。DOM 上にラベルとして
  // 残っていないことを確認する。
  it('「会員」「Bot」という独立タブは存在しない', () => {
    render(<BottomNav isAdmin />)
    expect(screen.queryByText('会員')).toBeNull()
    expect(screen.queryByText('Bot')).toBeNull()
    expect(screen.queryByText('予定')).toBeNull()
  })

  // AC-7: 設定ハブ配下の3ページのどれにいても「設定」タブが active になる。
  it.each(['/settings', '/admin/members', '/admin/line-channels'])(
    'pathname=%s で 設定 タブが active になる',
    (pathname) => {
      mockUsePathname.mockReturnValue(pathname)
      render(<BottomNav isAdmin />)
      const link = screen.getByText('設定').closest('a')
      expect(link?.className).toContain('border-brand')
    },
  )

  // AC-7: 詳細パスでも 設定 タブが active（設定ハブから辿った先だと分かる）。
  // `/admin/members/42/edit` は会員タブ時代からの回帰ガードを設定タブへ
  // 引き継いだもの。
  it.each([
    '/settings/notifications',
    '/settings/line-link',
    '/admin/members/42/edit',
  ])('pathname=%s のような詳細パスでも 設定 タブが active', (pathname) => {
    mockUsePathname.mockReturnValue(pathname)
    render(<BottomNav isAdmin />)
    const link = screen.getByText('設定').closest('a')
    expect(link?.className).toContain('border-brand')
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

  // AC-8（entry-management の実効的な検証を踏襲）: /admin/entries を開いた
  // とき、申込管理 タブだけが active になり、設定タブを含む他タブは光らない
  // （設定タブの matches に /admin/members・/admin/line-channels が入った
  // ことで誤爆しないことも含めて確認）。
  it('pathname=/admin/entries で 申込管理 タブが active になり、他タブは active にならない', () => {
    mockUsePathname.mockReturnValue('/admin/entries')
    render(<BottomNav isAdmin />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(6)
    const activeLinks = links.filter((link) =>
      link.className.includes('border-brand'),
    )
    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0]?.textContent?.trim()).toBe('申込管理')
    expect(screen.getByText('設定').closest('a')?.className).not.toContain(
      'border-brand',
    )
  })

  it('isAdmin=false でも pathname=/admin/entries で 申込管理 タブが active になる', () => {
    mockUsePathname.mockReturnValue('/admin/entries')
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('申込管理').closest('a')
    expect(link?.getAttribute('href')).toBe('/admin/entries')
    expect(link?.className).toContain('border-brand')
  })

  // entry-group-page AC-34: このパス形は申込グループページ
  // （/admin/entries/[groupId]）そのものを指す。matches の前方一致
  // （'/admin/entries'）により追加設定なしで active になることをここで固定する。
  it('pathname=/admin/entries/42 のような詳細パスでも 申込管理 タブが active', () => {
    mockUsePathname.mockReturnValue('/admin/entries/42')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('申込管理').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/events で 大会 タブが active になる', () => {
    mockUsePathname.mockReturnValue('/events')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('大会').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  it('pathname=/events/123 のような詳細パスでも 大会 タブが active', () => {
    mockUsePathname.mockReturnValue('/events/123')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('大会').closest('a')
    expect(link?.className).toContain('border-brand')
  })

  // AC-8（回帰）: `startsWith('/events')` previously matched `/events-archive`
  // and lit up the wrong tab. Segment-boundary matching fixes this.
  it('pathname=/events-archive では 大会 タブが active にならない', () => {
    mockUsePathname.mockReturnValue('/events-archive')
    render(<BottomNav isAdmin />)
    const link = screen.getByText('大会').closest('a')
    expect(link?.className).not.toContain('border-brand')
    expect(link?.className).toContain('border-transparent')
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

  it('各タブの href が正しい（ホーム/大会/申込管理/統計/メール/設定）', () => {
    render(<BottomNav isAdmin />)
    const expected: ReadonlyArray<[string, string]> = [
      ['ホーム', '/dashboard'],
      ['大会', '/events'],
      ['申込管理', '/admin/entries'],
      ['統計', '/players'],
      ['メール', '/admin/mail-inbox'],
      ['設定', '/settings'],
    ]
    for (const [label, href] of expected) {
      const link = screen.getByText(label).closest('a')
      expect(link?.getAttribute('href')).toBe(href)
    }
  })

  // AC-16: role-preview-switch。プレビュー中は「設定」タブにバッジが出る。
  it('previewRoleLabel 指定時、設定タブにバッジと aria-label が表示される', () => {
    render(<BottomNav isAdmin={false} previewRoleLabel="一般会員" />)
    const link = screen.getByText('設定').closest('a')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('一般会員')
    expect(link?.getAttribute('aria-label')).toBe(
      '設定（一般会員として表示中）',
    )
  })

  // AC-16: 非プレビュー時（previewRoleLabel 省略・null）はバッジも
  // aria-label も出ない。
  it('previewRoleLabel 未指定時、設定タブにバッジが出ない', () => {
    render(<BottomNav isAdmin={false} />)
    const link = screen.getByText('設定').closest('a')
    expect(link?.textContent?.trim()).toBe('設定')
    expect(link?.getAttribute('aria-label')).toBeNull()
  })

  it('previewRoleLabel=null 明示時もバッジが出ない', () => {
    render(<BottomNav isAdmin={false} previewRoleLabel={null} />)
    const link = screen.getByText('設定').closest('a')
    expect(link?.textContent?.trim()).toBe('設定')
    expect(link?.getAttribute('aria-label')).toBeNull()
  })

  // バッジは「設定」タブ専用。他タブに previewRoleLabel が漏れないこと。
  it('previewRoleLabel 指定時でも 設定 以外のタブにはバッジが出ない', () => {
    render(<BottomNav isAdmin previewRoleLabel="一般会員" />)
    const homeLink = screen.getByText('ホーム').closest('a')
    expect(homeLink?.textContent).not.toContain('一般会員')
    expect(homeLink?.getAttribute('aria-label')).toBeNull()
  })

  // guest-role AC-8: ゲストは「大会」「設定」の2タブだけ。ホーム・統計・
  // 申込管理・メールは描画されない。
  describe('isGuest（guest-role AC-8）', () => {
    it('isGuest=true のとき 大会/設定 の2タブだけが、この順序で表示される', () => {
      render(<BottomNav isAdmin={false} isGuest />)
      const links = screen.getAllByRole('link')
      expect(links.map((link) => link.textContent?.trim())).toEqual([
        '大会',
        '設定',
      ])
    })

    it('isGuest=true のとき ホーム・統計・申込管理・メールが描画されない', () => {
      render(<BottomNav isAdmin={false} isGuest />)
      expect(screen.queryByText('ホーム')).toBeNull()
      expect(screen.queryByText('統計')).toBeNull()
      expect(screen.queryByText('申込管理')).toBeNull()
      expect(screen.queryByText('メール')).toBeNull()
    })

    it('isGuest 省略時（既定 false）は従来どおり6タブ表示される（回帰）', () => {
      render(<BottomNav isAdmin={false} />)
      expect(screen.getAllByRole('link')).toHaveLength(6)
    })

    it('isGuest=true でも 大会 タブの href/active 判定は変わらない', () => {
      mockUsePathname.mockReturnValue('/events/123')
      render(<BottomNav isAdmin={false} isGuest />)
      const link = screen.getByText('大会').closest('a')
      expect(link?.getAttribute('href')).toBe('/events')
      expect(link?.className).toContain('border-brand')
    })

    // role-preview-switch AC-13 / AC-23: ゲストビュー中は 2 タブ化とバッジが
    // 同時に起きる。タブの絞り込み（`guestVisible`）がバッジを道連れに落とすと
    // 復帰導線が「どのロールで見ているか分からない」状態になる。
    it('isGuest=true でも 設定 タブのバッジは出る（2タブ化と両立する）', () => {
      render(<BottomNav isAdmin={false} isGuest previewRoleLabel="ゲスト" />)
      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(2)
      const settingsLink = screen.getByText('設定').closest('a')
      expect(settingsLink?.textContent).toContain('ゲスト')
      expect(settingsLink?.getAttribute('aria-label')).toBe(
        '設定（ゲストとして表示中）',
      )
    })
  })
})
