import { expect, test } from '@playwright/test'
import bcrypt from 'bcrypt'
import { createUser } from '../src/test-utils/seed'
import { truncateAll } from '../src/test-utils/db'

test.describe('Credentials login + forced password change', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('ログイン → mustChangePassword=true → /change-password にリダイレクト → 変更後ダッシュボード到達', async ({
    page,
  }) => {
    const passwordHash = await bcrypt.hash('pppppppp', 4)
    await createUser({
      name: 'alice',
      passwordHash,
      isInvited: true,
      mustChangePassword: true,
      role: 'member',
      grade: 'A',
    })

    // 1. Visit /login, submit credentials
    await page.goto('/login')
    await page.getByLabel('ユーザー名').fill('alice')
    await page.getByLabel('パスワード', { exact: true }).fill('pppppppp')
    await page.getByRole('button', { name: /ログイン/ }).click()

    // 2. Should be redirected to /change-password
    await expect(page.getByRole('heading', { name: 'パスワード変更' })).toBeVisible()
    await expect(page).toHaveURL(/\/change-password$/)

    // 3. Submit new password
    await page.getByLabel('現在のパスワード').fill('pppppppp')
    await page.getByLabel(/新しいパスワード（[0-9]+文字以上）/).fill('newpassword123')
    await page.getByLabel('新しいパスワード（確認）').fill('newpassword123')
    await page.getByRole('button', { name: /パスワードを変更/ }).click()

    // 4. After change: server signs us out and sends us to /login
    await expect(page).toHaveURL(/\/login$/)

    // 5. Log in with new password
    await page.getByLabel('ユーザー名').fill('alice')
    await page.getByLabel('パスワード', { exact: true }).fill('newpassword123')
    await page.getByRole('button', { name: /ログイン/ }).click()

    // 6. Now mustChangePassword=false → should reach the dashboard
    await expect(page).toHaveURL(/\/(dashboard)?$/)
  })

  test('誤ったパスワードで失敗し、エラーメッセージを表示', async ({ page }) => {
    const passwordHash = await bcrypt.hash('correct123', 4)
    await createUser({
      name: 'bob',
      passwordHash,
      isInvited: true,
      mustChangePassword: false,
    })

    await page.goto('/login')
    await page.getByLabel('ユーザー名').fill('bob')
    await page.getByLabel('パスワード', { exact: true }).fill('wrong')
    await page.getByRole('button', { name: /ログイン/ }).click()

    await expect(page.getByText(/ユーザー名またはパスワード/)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})
