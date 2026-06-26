import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { registrationInvites, users } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  issueUnboundLineSession,
  seedAdminSession,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { createUser } from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * invite-link-registration E2E.
 *
 * Covers the registrant side (welcome → form → create, expired-link rejection,
 * already-bound redirect) and the admin issue side. The real LINE OAuth
 * round-trip is skipped: the "logged in via LINE, not yet bound" state is
 * injected directly via issueUnboundLineSession (lineUserId set, id unset) —
 * the same technique self-identify-flow.spec.ts uses.
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

const DAY_MS = 24 * 60 * 60 * 1000

/** Seed a registration_invites row (with a throwaway issuer for the FK). */
async function seedInvite(
  token: string,
  opts?: { expiresAt?: Date; revokedAt?: Date | null },
) {
  const issuer = await createUser({ name: `issuer-${token}`, role: 'admin' })
  await testDb.insert(registrationInvites).values({
    token,
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
    createdBy: issuer.id,
    revokedAt: opts?.revokedAt ?? null,
  })
}

test.describe('invite-link-registration', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('未ログインで開くと ウェルカム + LINEで登録 ボタンが出る（フォームは出ない）', async ({
    browser,
  }) => {
    await seedInvite('e2e-welcome')

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/register/e2e-welcome')
    await expect(page.getByRole('button', { name: 'LINE で登録' })).toBeVisible()
    // The name/grade form must not appear before LINE auth.
    await expect(page.getByLabel('お名前（必須）')).toHaveCount(0)

    await context.close()
  })

  test('LINEログイン済み・未紐付け → 氏名+級フォーム → 登録 → dashboard、DBに会員作成', async ({
    browser,
  }) => {
    await seedInvite('e2e-form')
    const { sessionToken } = await issueUnboundLineSession('Ureg-e2e-1')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-form')
    // Unbound + /register/* is the middleware exception → the form renders.
    const nameInput = page.getByLabel('お名前（必須）')
    await expect(nameInput).toBeVisible()

    await nameInput.fill('E2E 新人')
    await page.getByLabel('級（任意）').selectOption('B')
    await page.getByRole('button', { name: '登録する' }).click()

    // registerViaInvite redirects to /; bound users may be routed on to /dashboard.
    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })

    const created = await testDb.query.users.findFirst({
      where: eq(users.name, 'E2E 新人'),
    })
    expect(created?.role).toBe('member')
    expect(created?.isInvited).toBe(true)
    expect(created?.grade).toBe('B')
    expect(created?.lineUserId).toBe('Ureg-e2e-1')
    expect(created?.lineLinkedMethod).toBe('invite_link')
    expect(created?.lineLinkedAt).toBeInstanceOf(Date)

    await context.close()
  })

  test('期限切れトークンは無効メッセージのみ（LINEボタンもフォームも出ない）', async ({
    browser,
  }) => {
    await seedInvite('e2e-expired', { expiresAt: new Date(Date.now() - DAY_MS) })

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/register/e2e-expired')
    await expect(
      page.getByText('この招待リンクは無効か期限切れです。管理者にご連絡ください。'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'LINE で登録' })).toHaveCount(0)
    await expect(page.getByLabel('お名前（必須）')).toHaveCount(0)

    await context.close()
  })

  test('存在しないトークンも無効メッセージ', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/register/no-such-token-at-all')
    await expect(
      page.getByText('この招待リンクは無効か期限切れです。管理者にご連絡ください。'),
    ).toBeVisible()

    await context.close()
  })

  test('既に紐付け済みの会員が開くと /register に留まらず dashboard へ', async ({
    browser,
  }) => {
    await seedInvite('e2e-bound')
    const { sessionToken } = await seedMemberSession({
      name: 'Bound Member',
      lineUserId: 'Ualready-bound',
      lineLinkedAt: new Date(),
      lineLinkedMethod: 'invite_link',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-bound')
    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })
    expect(page.url()).not.toContain('/register/')

    await context.close()
  })

  test('管理者が会員管理画面から招待リンクを発行 → モーダルにURL表示 + DBに行', async ({
    browser,
  }) => {
    const { sessionToken } = await seedAdminSession({ name: 'Invite Issuer' })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/admin/members')
    await page.getByRole('button', { name: '招待リンクを発行' }).click()

    await expect(
      page.getByRole('heading', { name: '招待リンクを発行しました' }),
    ).toBeVisible()
    // The modal shows the full /register/<token> URL.
    await expect(page.getByText(/\/register\//)).toBeVisible()

    const rows = await testDb.select().from(registrationInvites)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.revokedAt).toBeNull()

    await context.close()
  })
})
