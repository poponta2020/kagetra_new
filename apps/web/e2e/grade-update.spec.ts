import { expect, test } from '@playwright/test'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { createEvent } from '../src/test-utils/seed'
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

test.describe('Admin grade update changes member eligibility', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('grade が設定されると対象大会に回答できるようになる', async ({ browser }) => {
    // Seed: admin, member (grade=null, invited), event eligible for grade A only.
    const admin = await seedAdminSession({ name: 'Admin User' })
    const member = await seedMemberSession({
      name: 'Target Member',
      grade: null,
      isInvited: true,
    })
    const event = await createEvent({
      title: 'E5 Grade Update',
      eligibleGrades: ['A'],
    })

    const memberContext = await browser.newContext()
    await addSessionCookie(memberContext, member.sessionToken)
    const memberPage = await memberContext.newPage()

    // Before grade update: member has no grade → form is hidden with ガイドメッセージ
    await memberPage.goto(`/events/${event.id}`)
    await expect(
      memberPage.getByText(/級が未設定/),
    ).toBeVisible()
    await expect(
      memberPage.getByRole('button', { name: '参加', exact: true }),
    ).toHaveCount(0)

    // Admin updates member's grade to A
    const adminContext = await browser.newContext()
    await addSessionCookie(adminContext, admin.sessionToken)
    const adminPage = await adminContext.newPage()
    await adminPage.goto('/admin/members')
    const gradeSelect = adminPage.getByLabel('Target Member の級')
    await gradeSelect.selectOption('A')
    // Click 保存 button inside the same form as the target member's grade select
    const memberForm = adminPage.locator('form', { has: gradeSelect })
    await memberForm.getByRole('button', { name: '保存' }).click()
    // Wait for revalidation: the persisted value should reflect 'A'
    await expect(gradeSelect).toHaveValue('A')

    // After grade update: member can now respond
    await memberPage.goto(`/events/${event.id}`)
    await expect(
      memberPage.getByRole('button', { name: '参加', exact: true }),
    ).toBeVisible()

    await memberContext.close()
    await adminContext.close()
  })
})
