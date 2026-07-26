import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AccountMenu } from './account-menu'

describe('AccountMenu', () => {
  const noopSignOut = async () => {}

  it('トリガーに表示名を出し、初期状態ではシートを開かない', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    expect(screen.getByRole('button', { name: '山田さん' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('トリガーをタップするとシート(dialog)が開く', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy()
  })

  it('管理者にはメール通知リンク(/settings/notifications)が出る', () => {
    render(<AccountMenu user="山田さん" isAdmin signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    const link = screen.getByRole('link', { name: /メール通知/ })
    expect(link.getAttribute('href')).toBe('/settings/notifications')
  })

  it('一般会員にはメール通知リンクが出ない', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    expect(screen.queryByRole('link', { name: /メール通知/ })).toBeNull()
  })

  it('LINE アカウント切替リンク(/settings/line-link)は全員に出る', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    const link = screen.getByRole('link', { name: /LINE アカウント切替/ })
    expect(link.getAttribute('href')).toBe('/settings/line-link')
  })

  it('ログアウトは form 内の submit ボタンとして描画される', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    const logout = screen.getByRole('button', { name: 'ログアウト' }) as HTMLButtonElement
    expect(logout.type).toBe('submit')
    expect(logout.closest('form')).not.toBeNull()
  })

  it('× ボタンでシートを閉じる', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('背景クリックでシートを閉じる', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape キーでシートを閉じる', () => {
    render(<AccountMenu user="山田さん" isAdmin={false} signOutAction={noopSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: '山田さん' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('表示名が空でもトリガー(メニュー)を描画する', () => {
    render(<AccountMenu user="" isAdmin={false} signOutAction={noopSignOut} />)
    expect(screen.getByRole('button', { name: 'メニュー' })).toBeTruthy()
  })

  describe('role-preview-switch: 表示ロールセクション', () => {
    const noopSetRolePreview = async () => {}

    it('rolePreview が null のとき「表示ロール」が表示されない(AC-1, AC-2)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin={false}
          signOutAction={noopSignOut}
          rolePreview={null}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      expect(screen.queryByText('表示ロール')).toBeNull()
    })

    it('admin の rolePreview では 管理者/副管理者/一般会員 の3ボタンが出る(AC-3)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin
          signOutAction={noopSignOut}
          rolePreview={{ current: 'admin', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      expect(screen.getByRole('button', { name: '管理者' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '副管理者' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '一般会員' })).toBeTruthy()
    })

    it('vice_admin の rolePreview では 副管理者/一般会員 の2ボタンのみで「管理者」が無い(AC-4)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin
          signOutAction={noopSignOut}
          rolePreview={{ current: 'vice_admin', real: 'vice_admin', selectable: ['vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      expect(screen.getByRole('button', { name: '副管理者' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '一般会員' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '管理者' })).toBeNull()
    })

    it('previewBadge があるとトリガー内にバッジが描画され、タップでシートが開く(AC-13, AC-14)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin={false}
          signOutAction={noopSignOut}
          previewBadge="会員ビュー"
        />,
      )
      const trigger = screen.getByRole('button', { name: /会員ビュー/ })
      expect(trigger.textContent).toContain('会員ビュー')
      fireEvent.click(trigger)
      expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy()
    })

    it('previewBadge が null のときバッジが描画されない(AC-13)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin={false}
          signOutAction={noopSignOut}
          previewBadge={null}
        />,
      )
      expect(screen.queryByText(/ビュー/)).toBeNull()
    })

    it('プレビュー中(isAdmin=false)でも「管理者」ボタンが描画される(AC-9)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin={false}
          signOutAction={noopSignOut}
          rolePreview={{ current: 'member', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      expect(screen.getByRole('button', { name: '管理者' })).toBeTruthy()
    })

    it('de-list 中(isAdmin=false・selectable=[admin]のみ)でも「管理者」ボタンが1つだけ描画される(締め出し防止)', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin={false}
          signOutAction={noopSignOut}
          rolePreview={{ current: 'member', real: 'admin', selectable: ['admin'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      expect(screen.getAllByRole('button', { name: '管理者' })).toHaveLength(1)
    })

    it('切替ボタンは onClick でシートを閉じない（クリック処理中に form が外れると送信が中止されるため）', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin
          signOutAction={noopSignOut}
          rolePreview={{ current: 'admin', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      fireEvent.click(screen.getByRole('button', { name: '一般会員' }))
      expect(screen.queryByRole('dialog', { name: '設定' })).not.toBeNull()
    })

    it('サーバー側の再描画で実効ロールが変わるとシートが閉じる', () => {
      const props = {
        user: '山田さん',
        signOutAction: noopSignOut,
        setRolePreviewAction: noopSetRolePreview,
      }
      const { rerender } = render(
        <AccountMenu
          {...props}
          isAdmin
          rolePreview={{ current: 'admin', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy()
      rerender(
        <AccountMenu
          {...props}
          isAdmin={false}
          previewBadge="会員ビュー"
          rolePreview={{ current: 'member', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
        />,
      )
      expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull()
    })

    it('現在の実効ロールのボタンに aria-current="true" が付く', () => {
      render(
        <AccountMenu
          user="山田さん"
          isAdmin
          signOutAction={noopSignOut}
          rolePreview={{ current: 'vice_admin', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      const current = screen.getByRole('button', { name: '副管理者' })
      expect(current.getAttribute('aria-current')).toBe('true')
      const other = screen.getByRole('button', { name: '管理者' })
      expect(other.getAttribute('aria-current')).toBeNull()
    })

    it('returnTo の hidden input が form 内に存在する', () => {
      window.history.replaceState({}, '', '/')
      render(
        <AccountMenu
          user="山田さん"
          isAdmin
          signOutAction={noopSignOut}
          rolePreview={{ current: 'admin', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      const hidden = document.querySelector(
        'input[type="hidden"][name="returnTo"]',
      ) as HTMLInputElement
      expect(hidden).not.toBeNull()
      expect(hidden.value).toBe('/')
      expect(hidden.closest('form')).not.toBeNull()
    })

    it('returnTo にクエリ文字列も含める（切替でフィルタ条件を失わない）', () => {
      window.history.replaceState({}, '', '/players/ranking?grade=A&years=5')
      render(
        <AccountMenu
          user="山田さん"
          isAdmin
          signOutAction={noopSignOut}
          rolePreview={{ current: 'admin', real: 'admin', selectable: ['admin', 'vice_admin', 'member'] }}
          setRolePreviewAction={noopSetRolePreview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /山田さん/ }))
      const hidden = document.querySelector(
        'input[type="hidden"][name="returnTo"]',
      ) as HTMLInputElement
      expect(hidden.value).toBe('/players/ranking?grade=A&years=5')
      window.history.replaceState({}, '', '/')
    })
  })
})
