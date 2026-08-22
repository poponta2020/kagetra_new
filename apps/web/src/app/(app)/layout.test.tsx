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

  // role-preview-switch AC-23 / AC-13: `isGuest`（2タブ化）と
  // `previewRoleLabel`（設定タブのバッジ）が同時に導出される唯一の場所。
  it('ゲストビュー中の管理者は isGuest=true かつバッジが「ゲスト」（AC-13 / AC-23）', async () => {
    await setAuthSession({ id: 'u-admin', role: 'guest', realRole: 'admin' })
    await renderLayout()
    expect(screen.getByTestId('mobile-shell').textContent).toContain(
      'shell:false:true:ゲスト',
    )
  })

  it('本物のゲストは許可リストに載っていてもバッジが出ない（AC-26）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-guest')
    await setAuthSession({ id: 'u-guest', role: 'guest' })
    await renderLayout()
    expect(screen.getByTestId('mobile-shell').textContent).toContain(
      'shell:false:true:none',
    )
    vi.unstubAllEnvs()
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
