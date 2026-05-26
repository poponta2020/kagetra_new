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
  // sizing the shell to the visible viewport (h-dvh with h-screen fallback)
  // so only <main> scrolls. Reverting either class re-introduces the body-
  // scroll bug where the bars vanish off-screen.
  it('シェルが h-dvh + h-screen フォールバック + flex 縦並びで構成される', () => {
    const { container } = render(
      <MobileShell user="山田さん" isAdmin signOutAction={noopSignOut}>
        <div>child</div>
      </MobileShell>,
    )
    const shell = container.firstChild as HTMLElement
    expect(shell.className).toContain('h-dvh')
    expect(shell.className).toContain('h-screen')
    expect(shell.className).toContain('flex')
    expect(shell.className).toContain('flex-col')
  })

  it('<main> が flex-1 overflow-y-auto を持ち、children を描画する', () => {
    render(
      <MobileShell user="山田さん" isAdmin signOutAction={noopSignOut}>
        <div data-testid="child">child-content</div>
      </MobileShell>,
    )
    const main = screen.getByRole('main')
    expect(main.className).toContain('flex-1')
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
