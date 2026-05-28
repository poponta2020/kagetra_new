import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileShell } from './mobile-shell'

vi.mock('./app-bar-main', () => ({
  AppBarMain: ({ user }: { user: string; signOutAction: () => Promise<void> }) => (
    <div data-testid="app-bar-main">app-bar:{user}</div>
  ),
}))

vi.mock('./bottom-nav', () => ({
  BottomNav: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="bottom-nav">bottom-nav:{String(isAdmin)}</div>
  ),
}))

describe('MobileShell', () => {
  const noopSignOut = async () => {}

  // Regression guard: keeps AppBar/BottomNav pinned to viewport edges by
  // sizing the shell with the h-screen → h-dvh → h-svh cascade. iOS Safari
  // (15.4+) with viewport-fit=cover returns a `100dvh` that includes the
  // bottom URL bar overlay, so we end the cascade on h-svh (small viewport
  // height) — guarantees BottomNav stays above the URL bar. Reverting any
  // of the three classes re-introduces a known bug from PR #64/#67.
  it('シェルが h-screen → h-dvh → h-svh の高さ cascade + flex 縦並びで構成される', () => {
    const { container } = render(
      <MobileShell user="山田さん" isAdmin signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    const shell = container.firstChild as HTMLElement
    expect(shell.className).toContain('h-screen')
    expect(shell.className).toContain('h-dvh')
    expect(shell.className).toContain('h-svh')
    expect(shell.className).toContain('flex')
    expect(shell.className).toContain('flex-col')
    // Defensive: ensure h-svh appears AFTER h-dvh so the generated CSS
    // order (Tailwind preserves authored order in arbitrary/utility class
    // groups) keeps `100svh` as the winning declaration. If a future
    // refactor reorders these, the BottomNav-under-URL-bar bug returns.
    const dvhIndex = shell.className.indexOf('h-dvh')
    const svhIndex = shell.className.indexOf('h-svh')
    expect(svhIndex).toBeGreaterThan(dvhIndex)
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
    expect(screen.getByTestId('app-bar-main').textContent).toBe('app-bar:山田さん')
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
