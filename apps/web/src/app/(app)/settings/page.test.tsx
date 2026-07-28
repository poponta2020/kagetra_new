import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// 設定ハブ（/settings）: 権限による項目出し分けと、role-preview-switch の
// 「表示ロール」セクションの描画条件を固定する。DB へは触れないページなので
// テスト DB のシード (test-utils/seed) は使わない。

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: SettingsPage } = await import('./page')

async function renderPage() {
  const ui = await SettingsPage()
  return render(ui)
}

describe('/settings（設定ハブ）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('一般会員（AC-9）', () => {
    it('LINE アカウント切替とログアウトのみが表示される', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-member', role: 'member', name: '山田太郎' })
      await renderPage()

      const lineLink = screen.getByRole('link', { name: /LINE アカウント切替/ })
      expect(lineLink.getAttribute('href')).toBe('/settings/line-link')
      expect(screen.getByRole('button', { name: 'ログアウト' })).toBeTruthy()
    })

    it('会員・メール通知・Bot と「管理」セクションが出ない', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-member', role: 'member', name: '山田太郎' })
      await renderPage()

      expect(screen.queryByText('管理')).toBeNull()
      expect(screen.queryByText('会員')).toBeNull()
      expect(screen.queryByText('メール通知')).toBeNull()
      expect(screen.queryByText('Bot')).toBeNull()
    })
  })

  describe('管理者（AC-10, AC-11）', () => {
    it('会員・メール通知・Bot が正しい href で表示される', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-admin', role: 'admin', name: '管理太郎' })
      await renderPage()

      expect(screen.getByText('管理')).toBeTruthy()
      expect(
        screen.getByRole('link', { name: /^会員/ }).getAttribute('href'),
      ).toBe('/admin/members')
      expect(
        screen.getByRole('link', { name: /メール通知/ }).getAttribute('href'),
      ).toBe('/settings/notifications')
      expect(
        screen.getByRole('link', { name: /^Bot/ }).getAttribute('href'),
      ).toBe('/admin/line-channels')
      expect(
        screen.getByRole('link', { name: /LINE アカウント切替/ }).getAttribute('href'),
      ).toBe('/settings/line-link')
    })
  })

  describe('申込書設定リンク（entry-form-autofill AC-1, AC-2）', () => {
    it('admin には表示され /settings/entry-form を指す。一般会員には表示されない', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-admin', role: 'admin', name: '管理太郎' })
      await renderPage()

      expect(
        screen.getByRole('link', { name: /申込書設定/ }).getAttribute('href'),
      ).toBe('/settings/entry-form')
    })

    it('一般会員には表示されない', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-member', role: 'member', name: '山田太郎' })
      await renderPage()

      expect(screen.queryByText('申込書設定')).toBeNull()
    })
  })

  describe('ユーザー名表示（AC-12）', () => {
    it('「◯◯さん」が表示される', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-member', role: 'member', name: '山田太郎' })
      await renderPage()

      expect(screen.getByText('山田太郎さん')).toBeTruthy()
    })
  })

  describe('表示ロール（AC-13, AC-14）', () => {
    it('rolePreview が null のとき「表示ロール」セクションが描画されない', async () => {
      // 許可リスト外・非プレビュー（realRole === role）→ buildRolePreviewSelection は null。
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-admin', role: 'admin' })
      await renderPage()

      expect(screen.queryByText('表示ロール')).toBeNull()
    })

    it('許可リストに載った admin は選択肢が並び、現在ロールに aria-current と「本来のロール」Pill が付く', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
      await setAuthSession({ id: 'u-admin', role: 'admin' })
      await renderPage()

      expect(screen.getByText('表示ロール')).toBeTruthy()
      // `/管理者/` だと「副管理者」にも当たるので先頭アンカーで絞る。
      // 現在ロールのボタンは Pill 分の文言が付くため完全一致は使えない。
      const adminButton = screen.getByRole('button', { name: /^管理者/ })
      expect(adminButton.getAttribute('aria-current')).toBe('true')
      expect(within(adminButton).getByText('本来のロール')).toBeTruthy()
      expect(screen.getByRole('button', { name: /副管理者/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /一般会員/ })).toBeTruthy()
    })

    it('プレビュー中は現在ロールに aria-current と「表示中」Pill が付く', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
      await setAuthSession({ id: 'u-admin', role: 'member', realRole: 'admin' })
      await renderPage()

      const memberButton = screen.getByRole('button', { name: /一般会員/ })
      expect(memberButton.getAttribute('aria-current')).toBe('true')
      expect(within(memberButton).getByText('表示中')).toBeTruthy()
      // 本来のロール（admin）には Pill が付かない。
      const adminButton = screen.getByRole('button', { name: '管理者' })
      expect(adminButton.getAttribute('aria-current')).toBeNull()
    })
  })

  describe('表示ロールフォームの returnTo（AC-15）', () => {
    // AC-15 の担保は 2 段: ここでは「フォームが /settings を送る」までを
    // 固定する。「Server Action が受け取った returnTo へ redirect する」は
    // role-preview-actions.test.ts の「returnTo の相対パスへ戻す」でカバー済み。
    it('hidden input の returnTo が /settings を指す', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
      await setAuthSession({ id: 'u-admin', role: 'admin' })
      const { container } = await renderPage()

      const returnToInput = container.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="returnTo"]',
      )
      expect(returnToInput).not.toBeNull()
      expect(returnToInput?.value).toBe('/settings')
    })
  })

  describe('line-link のシェル内表示（AC-17）', () => {
    // DB に触れるページ（ユーザーの lineUserId を参照する）なのでここでは
    // レンダリングテストは書かない。(app) route group 配下＝シェル内である
    // ことと、旧来の孤児ページ用マークアップが残っていないことをソース
    // レベルで固定する。実ブラウザでの URL・ボトムナビ表示確認は E2E が持つ。
    it('/settings/line-link は (app) グループ内にあり、孤児ページ用マークアップを持たない', () => {
      // jsdom 環境では global の `URL` が jsdom 実装に差し替わっており、
      // `fileURLToPath(new URL(...))` は「The URL must be of scheme file」で
      // 落ちる。文字列の `import.meta.url` を直接渡してから join する。
      const settingsDir = dirname(fileURLToPath(import.meta.url))
      const source = readFileSync(
        join(settingsDir, 'line-link', 'page.tsx'),
        'utf-8',
      )
      expect(source).not.toContain('min-h-screen')
      // 旧・孤児ページ唯一の脱出口だった `<Link href="/dashboard">ダッシュ
      // ボードへ戻る</Link>`。文言はコード内コメントにも出てくるので、
      // リンクそのもの（href）の不在で判定する。
      expect(source).not.toMatch(/href=["']\/dashboard["']/)
    })
  })

  describe('ログアウト（AC-18）', () => {
    // Server Action (signOut) の中身までは検証しない。「ログアウトボタンが
    // form の submit として存在する」までを固定し、/auth/signin への実遷移は
    // E2E が持つ。
    it('ログアウトボタンが form の submit として存在する', async () => {
      vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
      await setAuthSession({ id: 'u-member', role: 'member' })
      await renderPage()

      const button = screen.getByRole('button', { name: 'ログアウト' })
      expect(button.getAttribute('type')).toBe('submit')
      expect(button.closest('form')).not.toBeNull()
    })
  })
})
