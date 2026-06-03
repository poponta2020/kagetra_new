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

test.describe('Settings entry point (header → settings sheet)', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('管理者: {name}さん タップで設定シートが開き、メール通知へ遷移できる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin User' })
    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto('/dashboard')

    // The header name label is the settings trigger (design.md §3:
    // "設定は `{name}さん` をタップしてシート").
    await page.getByRole('button', { name: 'Admin Userさん' }).click()

    const sheet = page.getByRole('dialog', { name: '設定' })
    await expect(sheet).toBeVisible()

    // Admin sees both settings entries; the メール通知 entry is admin-gated.
    await expect(sheet.getByRole('link', { name: 'メール通知' })).toBeVisible()
    await expect(
      sheet.getByRole('link', { name: 'LINE アカウント切替' }),
    ).toBeVisible()

    // Navigate to the notifications settings page via the sheet.
    await sheet.getByRole('link', { name: 'メール通知' }).click()
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
})
