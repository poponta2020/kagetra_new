import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileShell } from './mobile-shell'

vi.mock('./bottom-nav', () => ({
  BottomNav: ({
    isAdmin,
    previewRoleLabel,
  }: {
    isAdmin: boolean
    previewRoleLabel?: string | null
  }) => (
    <nav data-testid="bottom-nav">
      bottom-nav:{String(isAdmin)}:{previewRoleLabel ?? 'none'}
    </nav>
  ),
}))

describe('MobileShell', () => {
  // AC-1 / AC-2: nav-settings-hub で上部バー（ワードマーク「かげとら」＋
  // `{name}さん` の設定シートトリガー）を廃止した。シェルの子は <main> と
  // <nav> の 2 つだけになったことを機械的に固定する。
  it('子は <main> と <nav> の 2 つだけで、ワードマークもユーザー名も DOM に無い', () => {
    const { container } = render(
      <MobileShell isAdmin>
        <div>child</div>
      </MobileShell>,
    )
    const shell = container.firstChild as HTMLElement
    const childTags = Array.from(shell.children).map((el) => el.tagName)
    expect(childTags).toEqual(['MAIN', 'NAV'])
    expect(screen.queryByText('かげとら')).toBeNull()
    expect(screen.queryByText(/さん$/)).toBeNull()
  })

  // Regression guard: shell uses the `.mobile-shell-h` rule from
  // globals.css, which declares `height: 100vh; height: 100dvh; height:
  // 100svh;` in that order inside a SINGLE CSS rule so the cascade is
  // deterministic. Composing this via Tailwind utilities (`h-screen
  // h-dvh h-svh`) is unsafe — Tailwind's utility output order is NOT
  // controlled by className order, so the winning value can't be
  // guaranteed (PR #68 R1 Codex blocker). Reverting to utilities
  // re-introduces the iOS Safari BottomNav-under-URL-bar bug (#53).
  it('シェルが mobile-shell-h クラス + flex 縦並びで構成される', () => {
    const { container } = render(
      <MobileShell isAdmin>
        <div>child</div>
      </MobileShell>,
    )
    const shell = container.firstChild as HTMLElement
    expect(shell.className).toContain('mobile-shell-h')
    expect(shell.className).toContain('flex')
    expect(shell.className).toContain('flex-col')
    // Defensive: ensure no Tailwind height utility leaked back in. Any
    // of these would compete with the deterministic cascade in
    // globals.css and the winner becomes undefined.
    expect(shell.className).not.toMatch(/\bh-screen\b/)
    expect(shell.className).not.toMatch(/\bh-dvh\b/)
    expect(shell.className).not.toMatch(/\bh-svh\b/)
  })

  it('<main> が flex-1 min-h-0 overflow-y-auto を持ち、children を描画する', () => {
    render(
      <MobileShell isAdmin>
        <div data-testid="child">child-content</div>
      </MobileShell>,
    )
    const main = screen.getByRole('main')
    expect(main.className).toContain('flex-1')
    // Regression guard: without `min-h-0`, flex items default to
    // `min-height: auto` which lets <main> grow past the shell, the shell
    // exceeds h-dvh, and body scroll carries BottomNav off-screen on iOS
    // Safari. Removing this class re-introduces the PR #64 followup bug
    // (BottomNav disappears while scrolling).
    expect(main.className).toContain('min-h-0')
    expect(main.className).toContain('overflow-y-auto')
    expect(screen.getByTestId('child').textContent).toBe('child-content')
  })

  // AC-3（event-list-redesign AC-14 の踏襲）: /events はページ余白 16px を
  // 自前で持つ（`page.tsx` の `p-4`）。同じ余白を共通シェルの <main> に足すと、
  // すでに `p-4` を自前で持つ /tournaments・/players/[id] 等が二重余白になる。
  // 余白はページ側で完結させる、というこの境界を機械的に固定する
  // （PR #345 の回帰ガード。nav-settings-hub では §3.5 で 14 ページに `p-4` を
  // 追加したが、この境界自体は変えていない — page-padding.test.ts 参照）。
  it('<main> は padding を持たない（余白は各ページ側で完結させる）', () => {
    render(
      <MobileShell isAdmin>
        <div>child</div>
      </MobileShell>,
    )
    const main = screen.getByRole('main')
    // p-4 / px-4 / py-4 / pt-4 ... いずれの padding utility も入れない。
    expect(main.className).not.toMatch(/\bp[xytrbl]?-/)
  })

  it('BottomNav に isAdmin=false が透過される', () => {
    render(
      <MobileShell isAdmin={false}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('bottom-nav').textContent).toContain(
      'bottom-nav:false',
    )
  })

  it('BottomNav に isAdmin=true が透過される', () => {
    render(
      <MobileShell isAdmin>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('bottom-nav').textContent).toContain(
      'bottom-nav:true',
    )
  })

  // role-preview-switch: previewRoleLabel はワードマーク側ではなく BottomNav の
  // 「設定」タブのバッジへ素通しするだけ。MobileShell はそのまま透過するのみ。
  it('previewRoleLabel が BottomNav へ透過される', () => {
    render(
      <MobileShell isAdmin={false} previewRoleLabel="会員ビュー">
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('bottom-nav').textContent).toContain(
      '会員ビュー',
    )
  })

  it('previewRoleLabel 省略時は none として透過される（非プレビュー時）', () => {
    render(
      <MobileShell isAdmin={false}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('bottom-nav').textContent).toContain('none')
  })
})
