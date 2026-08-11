import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// guest-role タスク4: `(app)/layout.tsx` が `isAdmin` に加えて `isGuest` を
// `MobileShell` へ渡すことを固定する（AC-8 の前段。実際のタブ絞り込みは
// bottom-nav.test.tsx / mobile-shell.test.tsx が持つ）。

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())
vi.mock('@/components/layout/mobile-shell', () => ({
  MobileShell: ({
    isAdmin,
    isGuest,
    previewRoleLabel,
    children,
  }: {
    isAdmin: boolean
    isGuest?: boolean
    previewRoleLabel?: string | null
    children: ReactNode
  }) => (
    <div data-testid="mobile-shell">
      shell:{String(isAdmin)}:{String(isGuest ?? false)}:
      {previewRoleLabel ?? 'none'}
      {children}
    </div>
  ),
}))

const { default: AppLayout } = await import('./layout')

async function renderLayout() {
  return render(await AppLayout({ children: <div>child</div> }))
}

describe('(app)/layout', () => {
  it('ゲストは isGuest=true で MobileShell へ渡される', async () => {
    await setAuthSession({ id: 'u-guest', role: 'guest' })
    await renderLayout()
    expect(screen.getByTestId('mobile-shell').textContent).toContain(
      'shell:false:true:none',
    )
  })

  it('一般会員は isGuest=false（回帰）', async () => {
    await setAuthSession({ id: 'u-member', role: 'member' })
    await renderLayout()
    expect(screen.getByTestId('mobile-shell').textContent).toContain(
      'shell:false:false:none',
    )
  })

  it('管理者は isAdmin=true・isGuest=false（回帰）', async () => {
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await renderLayout()
    expect(screen.getByTestId('mobile-shell').textContent).toContain(
      'shell:true:false:none',
    )
  })
})
