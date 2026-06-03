import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileShell } from './mobile-shell'

vi.mock('./app-bar-main', () => ({
  AppBarMain: ({
    user,
    isAdmin,
  }: {
    user: string
    isAdmin: boolean
    signOutAction: () => Promise<void>
  }) => (
    <div data-testid="app-bar-main">
      app-bar:{user}:{String(isAdmin)}
    </div>
  ),
}))

vi.mock('./bottom-nav', () => ({
  BottomNav: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="bottom-nav">bottom-nav:{String(isAdmin)}</div>
  ),
}))

describe('MobileShell', () => {
  const noopSignOut = async () => {}

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
      <MobileShell user="山田さん" isAdmin signOutAction={noopSignOut}>
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
      <MobileShell user="山田さん" isAdmin signOutAction={noopSignOut}>
        <div data-testid="child">child-content</div>
      </MobileShell>,
    )
    const main = screen.getByRole('main')
    expect(main.className).toContain('flex-1')
    // Regression guard: without `min-h-0`, flex items default to
    // `min-height: auto` which lets <main> grow past the shell, the shell
    // exceeds h-dvh, and body scroll carries AppBar/BottomNav off-screen
    // on iOS Safari. Removing this class re-introduces the PR #64 followup
    // bug (BottomNav disappears while scrolling).
    expect(main.className).toContain('min-h-0')
    expect(main.className).toContain('overflow-y-auto')
    expect(screen.getByTestId('child').textContent).toBe('child-content')
  })

  it('AppBarMain に user prop が透過される', () => {
    render(
      <MobileShell user="山田さん" isAdmin={false} signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('app-bar-main').textContent).toContain('app-bar:山田さん')
  })

  it('AppBarMain に isAdmin が透過される（設定シートのメール通知出し分け用）', () => {
    const { rerender } = render(
      <MobileShell user="山田さん" isAdmin signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('app-bar-main').textContent).toContain(':true')
    rerender(
      <MobileShell user="山田さん" isAdmin={false} signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('app-bar-main').textContent).toContain(':false')
  })

  it('BottomNav に isAdmin=false が透過される', () => {
    render(
      <MobileShell user="" isAdmin={false} signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('bottom-nav').textContent).toBe('bottom-nav:false')
  })

  it('BottomNav に isAdmin=true が透過される', () => {
    render(
      <MobileShell user="" isAdmin signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    expect(screen.getByTestId('bottom-nav').textContent).toBe('bottom-nav:true')
  })
})
