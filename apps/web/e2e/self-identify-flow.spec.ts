import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  issueUnboundLineSession,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { createUser } from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * /self-identify E2E.
 *
 * The flow assumes Auth.js has already completed LINE OAuth and produced a
 * session where `token.lineUserId` is set but `token.id` is not — that's the
 * cue for middleware to route to /self-identify. We skip the real OAuth
 * round-trip entirely by injecting a pre-signed JWT via
 * `issueUnboundLineSession`, which is the same technique the rest of the E2E
 * suite uses for authenticated flows.
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

test.describe('/self-identify — first-time LINE claim', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('新規 LINE user → 候補選択 → dashboard、DB に lineUserId+method 記録', async ({
    browser,
  }) => {
    const alice = await createUser({
      name: 'Alice Self-Identify',
      isInvited: true,
      lineUserId: null,
    })
    const { sessionToken } = await issueUnboundLineSession('Uclaim-alice-1')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    // Any gated URL redirects unbound sessions to /self-identify.
    await page.goto('/')
    await expect(page).toHaveURL(/\/self-identify/)
    await expect(page.getByRole('heading', { name: 'あなたは誰ですか？' })).toBeVisible()

    // alice is visible in the candidate list — pick her.
    await page.getByRole('radio', { name: /Alice Self-Identify/ }).check()
    await page.getByRole('button', { name: 'このメンバーとして続ける' }).click()

    // After claim, the action redirects to /. Dashboard root may further
    // redirect to /dashboard — either terminal URL is a successful bind.
    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })

    const updated = await testDb.query.users.findFirst({
      where: eq(users.id, alice.id),
    })
    expect(updated?.lineUserId).toBe('Uclaim-alice-1')
    expect(updated?.lineLinkedMethod).toBe('self_identify')
    expect(updated?.lineLinkedAt).toBeInstanceOf(Date)

    await context.close()
  })

  test('既に紐付け済み user は /self-identify に来ずに dashboard へ直行', async ({
    browser,
  }) => {
    const { sessionToken } = await seedMemberSession({
      name: 'Already Linked',
      lineUserId: 'Ualready-linked',
      lineLinkedAt: new Date(),
      lineLinkedMethod: 'self_identify',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/')
    // Root routes to /dashboard for bound users; either endpoint means "no
    // /self-identify detour".
    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })
    expect(page.url()).not.toContain('/self-identify')

    await context.close()
  })

  test('招待されていない会員 (isInvited=false) は候補一覧に出ない', async ({
    browser,
  }) => {
    await createUser({ name: 'Alice Invited', isInvited: true, lineUserId: null })
    await createUser({
      name: 'Charlie NotInvited',
      isInvited: false,
      lineUserId: null,
    })

    const { sessionToken } = await issueUnboundLineSession('Uclaim-filter-test')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/self-identify')
    await expect(page.getByRole('radio', { name: /Alice Invited/ })).toBeVisible()
    await expect(page.getByText('Charlie NotInvited')).toHaveCount(0)

    await context.close()
  })

  test('退会済み (deactivatedAt) の会員は候補一覧に出ない', async ({ browser }) => {
    await createUser({ name: 'Alice Active', isInvited: true, lineUserId: null })
    await createUser({
      name: 'Dave Retired',
      isInvited: true,
      lineUserId: null,
      deactivatedAt: new Date('2026-04-18T00:00:00Z'),
    })

    const { sessionToken } = await issueUnboundLineSession('Uclaim-deact-test')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/self-identify')
    await expect(page.getByRole('radio', { name: /Alice Active/ })).toBeVisible()
    await expect(page.getByText('Dave Retired')).toHaveCount(0)

    await context.close()
  })

  test('候補ゼロの場合は管理者連絡メッセージを表示', async ({ browser }) => {
    // No invited+unlinked users seeded.
    const { sessionToken } = await issueUnboundLineSession('Uclaim-empty-list')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/self-identify')
    await expect(
      page.getByText('選択可能な会員がいません。管理者にご連絡ください。'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'このメンバーとして続ける' }),
    ).toHaveCount(0)

    await context.close()
  })
})
