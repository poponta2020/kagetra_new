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
})
