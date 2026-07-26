import { expect, test } from '@playwright/test'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import { truncateAll } from '../src/test-utils/db'

async function addSessionCookie(
  context: import('@playwright/test').BrowserContext,
  token: string,
) {
  await context.addCookies([
    {
      name: AUTHJS_SESSION_COOKIE,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test.describe('Settings entry point (bottom nav → /settings)', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('管理者: 設定タブから /settings へ遷移し、メール通知へ辿れる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin User' })
    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto('/dashboard')

    // nav-settings-hub: 上部バーの `{name}さん` タップ→設定シートは廃止され、
    // ボトムナビの「設定」タブから独立ページ /settings を開く導線になった。
    await page.getByRole('link', { name: '設定' }).click()
    await expect(page).toHaveURL(/\/settings$/)

    // Admin sees both settings entries; the メール通知 entry is admin-gated.
    await expect(page.getByRole('link', { name: 'メール通知' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'LINE アカウント切替' }),
    ).toBeVisible()

    // Navigate to the notifications settings page from the settings hub.
    await page.getByRole('link', { name: 'メール通知' }).click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
    await expect(
      page.getByRole('heading', { name: 'メール通知' }),
    ).toBeVisible()

    // Regression for the (app)-group move: the page now renders inside the
    // app shell, so the bottom-nav (ホーム tab) is present and the user can
    // navigate away — previously this page was orphaned with no way back.
    await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible()

    await context.close()
  })

  test('管理者: /settings/line-link はシェル内ページでボトムナビが孤児化しない', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin User' })
    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto('/settings')
    await page.getByRole('link', { name: 'LINE アカウント切替' }).click()

    await expect(page).toHaveURL(/\/settings\/line-link$/)
    await expect(
      page.getByRole('heading', { name: 'LINE アカウント切替' }),
    ).toBeVisible()

    // `(app)` グループ配下のシェル内ページとして描画されているので、
    // ボトムナビ（<nav>）が引き続き見える。以前は独立ページで孤児化していた。
    await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible()

    await context.close()
  })
})
