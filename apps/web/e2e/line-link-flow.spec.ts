import { expect, test } from '@playwright/test'
import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { testDb, truncateAll } from '../src/test-utils/db'
import { createUser } from '../src/test-utils/seed'

/**
 * LINE-link E2E.
 *
 * The LINE authorize endpoint is intercepted with `page.route` so we never
 * hit access.line.me. The callback handler itself honors
 * LINE_OAUTH_TEST_MODE=true (set in playwright.config.ts) and returns a
 * deterministic profile, so we can simulate a real OAuth round-trip without
 * any outbound HTTPS.
 */
test.describe('LINE link required after password change', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('パス変更後 lineUserId=NULL → /settings/line-link にリダイレクトされ、連携すると / に到達', async ({
    page,
    context,
  }) => {
    const passwordHash = await bcrypt.hash('newpassword123', 4)
    const user = await createUser({
      name: 'alice',
      passwordHash,
      isInvited: true,
      mustChangePassword: false,
      role: 'member',
      grade: 'A',
      lineUserId: null, // must explicitly override the test seed default
    })

    // 1. Log in with already-changed password → middleware pushes us to
    //    /settings/line-link because lineUserId is null.
    await page.goto('/login')
    await page.getByLabel('ユーザー名').fill('alice')
    await page.getByLabel('パスワード', { exact: true }).fill('newpassword123')
    await page.getByRole('button', { name: /ログイン/ }).click()

    await expect(page).toHaveURL(/\/settings\/line-link/)
    await expect(page.getByRole('heading', { name: 'LINE 連携' })).toBeVisible()

    // 2. Intercept the LINE authorize URL and redirect back to our callback
    //    with the same state (cookie → query).
    await context.route('**access.line.me/**', async (route) => {
      const url = new URL(route.request().url())
      const state = url.searchParams.get('state') ?? ''
      const callbackBase = url.searchParams.get('redirect_uri')
      if (!callbackBase) {
        await route.fulfill({ status: 400, body: 'missing redirect_uri' })
        return
      }
      const callbackUrl = new URL(callbackBase)
      callbackUrl.searchParams.set('code', 'fake-code')
      callbackUrl.searchParams.set('state', state)
      await route.fulfill({
        status: 302,
        headers: { location: callbackUrl.toString() },
      })
    })

    // 3. Click "LINE で連携する" → callback runs in LINE_OAUTH_TEST_MODE,
    //    persists lineUserId, refreshes JWT, redirects to /.
    await page.getByRole('button', { name: 'LINE で連携する' }).click()

    // 4. Final: we should land at dashboard root.
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 10_000 })

    // 5. DB must now have a non-null lineUserId for this user.
    const updated = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(updated?.lineUserId).toBeTruthy()
    expect(updated?.lineUserId).toMatch(/^Utest-/)
  })
})
