import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  issueUnboundLineSession,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import { createUser } from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * admin-member-create E2E.
 *
 * 管理画面からの新規会員登録 → 一覧反映 → self-identify 候補化、
 * 誤登録リカバリ（名前修正・削除）の一連フローを検証する。
 * 認証は他スペック同様、署名済み JWT cookie の直接注入で行う。
 */
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

test.describe('管理画面からの新規会員登録', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('管理者が新規会員を追加 → 一覧に反映され self-identify 候補にも出る', async ({
    browser,
  }) => {
    const { sessionToken } = await seedAdminSession({ name: 'Admin Creator' })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/admin/members')
    await page.getByRole('button', { name: '新規会員追加' }).click()
    await page.getByLabel('名前（必須）').fill('新井 一郎')
    await page.getByLabel('級', { exact: true }).selectOption('C')
    await page.getByRole('button', { name: '登録', exact: true }).click()

    await expect(page.getByRole('status')).toHaveText('登録しました。')
    // revalidatePath で一覧 (server component) にも即反映される
    await expect(page.getByRole('cell', { name: /新井 一郎/ })).toBeVisible()

    // 作成行は招待済み・member・未紐付け
    const created = await testDb.query.users.findFirst({
      where: eq(users.name, '新井 一郎'),
    })
    expect(created?.isInvited).toBe(true)
    expect(created?.role).toBe('member')
    expect(created?.grade).toBe('C')
    expect(created?.lineUserId).toBeNull()

    await context.close()

    // 本人の初回 LINE ログインを模した unbound セッションで候補に出ること
    const { sessionToken: lineToken } =
      await issueUnboundLineSession('Unew-member-claim')
    const lineContext = await browser.newContext()
    await addSessionCookie(lineContext, lineToken)
    const linePage = await lineContext.newPage()

    await linePage.goto('/self-identify')
    await expect(
      linePage.getByRole('radio', { name: /新井 一郎/ }),
    ).toBeVisible()

    await lineContext.close()
  })

  test('未紐付け会員の名前を編集ページで修正できる', async ({ browser }) => {
    const { sessionToken } = await seedAdminSession({ name: 'Admin Renamer' })
    const target = await createUser({
      name: '誤登録 太郎',
      isInvited: true,
      lineUserId: null,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/members/${target.id}/edit`)
    await expect(
      page.getByText('LINE 紐付け前のため修正できます。'),
    ).toBeVisible()

    await page.getByLabel('名前', { exact: true }).fill('正しい 太郎')
    await page.getByRole('button', { name: '名前を保存' }).click()

    await expect(page.getByRole('status')).toHaveText('名前を変更しました。')

    const renamed = await testDb.query.users.findFirst({
      where: eq(users.id, target.id),
    })
    expect(renamed?.name).toBe('正しい 太郎')

    await context.close()
  })

  test('紐付け済み会員の編集ページでは名前は readOnly のまま', async ({
    browser,
  }) => {
    const { sessionToken } = await seedAdminSession({ name: 'Admin Viewer' })
    const target = await createUser({
      name: '紐付け済み 次郎',
      isInvited: true,
      lineUserId: 'Ulinked-e2e',
      lineLinkedAt: new Date(),
      lineLinkedMethod: 'self_identify',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/members/${target.id}/edit`)
    await expect(
      page.getByText(
        'ユーザー名はログインに使われるため、この画面からは変更できません。',
      ),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '名前を保存' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'この会員を削除する' }),
    ).toHaveCount(0)

    await context.close()
  })

  test('削除すると一覧からも self-identify 候補からも消える', async ({
    browser,
  }) => {
    const { sessionToken } = await seedAdminSession({ name: 'Admin Deleter' })
    const target = await createUser({
      name: '削除対象 三郎',
      isInvited: true,
      lineUserId: null,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/members/${target.id}/edit`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'この会員を削除する' }).click()

    // 成功時は一覧へ redirect され、行が消えている
    await page.waitForURL(/\/admin\/members$/, { timeout: 5000 })
    await expect(page.getByRole('cell', { name: /削除対象 三郎/ })).toHaveCount(0)

    const gone = await testDb.query.users.findFirst({
      where: eq(users.id, target.id),
    })
    expect(gone).toBeUndefined()

    await context.close()

    // self-identify 候補からも消えている
    const { sessionToken: lineToken } =
      await issueUnboundLineSession('Udeleted-check')
    const lineContext = await browser.newContext()
    await addSessionCookie(lineContext, lineToken)
    const linePage = await lineContext.newPage()

    await linePage.goto('/self-identify')
    await expect(linePage.getByText('削除対象 三郎')).toHaveCount(0)

    await lineContext.close()
  })
})
