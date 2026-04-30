import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { mailWorkerJobs, mailWorkerRuns } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * /admin/mail-inbox manual fetch trigger E2E (PR5 Phase 4e).
 *
 * Covers the operator-facing path that lands a row in `mail_worker_jobs`:
 *   1. Header "メール取り込み" button opens the dialog.
 *   2. Default preset (7d) submits the Server Action.
 *   3. UI surfaces "ジョブ #N を予約しました" + DB row exists with
 *      status='pending' and requested_by_user_id=admin.id.
 *
 * The "最近の取り込み履歴" section's seeded row exercises the recent-runs
 * table render — the actual claim/run cycle lives in the mail-worker tests
 * (Phase 3) so this spec only asserts the page surfaces history, not that
 * the job ever transitions out of 'pending'.
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

test.describe.configure({ mode: 'serial' })

test.describe('/admin/mail-inbox manual fetch trigger', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('admin がメール取り込みボタンから 7d preset でジョブ予約できる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin Trigger' })

    // Seed one mail_worker_runs row so the recent-history section renders a
    // real entry (not the empty-state card). Mirrors the success summary the
    // pipeline writes when a cron run finishes cleanly.
    await testDb.insert(mailWorkerRuns).values({
      kind: 'cron',
      status: 'success',
      finishedAt: new Date(),
      summary: { drafts_created: 2 },
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto('/admin/mail-inbox')

    // History section is visible with the seeded run.
    await expect(page.getByText('最近の取り込み履歴')).toBeVisible()
    await expect(page.getByText('定期')).toBeVisible()
    await expect(page.getByText('成功')).toBeVisible()
    await expect(page.getByText('2 件')).toBeVisible()

    // Open the dialog from the header button.
    await page.getByRole('button', { name: 'メール取り込み' }).click()
    const dialog = page.getByRole('dialog', { name: 'メール取り込み' })
    await expect(dialog).toBeVisible()

    // Default selection is 7d (per pr5-plan.md Q5). Just confirm + submit.
    await expect(page.getByLabel('過去 7 日')).toBeChecked()
    await dialog.getByRole('button', { name: '実行' }).click()

    // Inline success message lists the jobId from the Server Action envelope.
    await expect(
      page.getByText(/ジョブ #\d+ を予約しました/),
    ).toBeVisible()

    // DB should hold exactly one pending job for this admin.
    const jobs = await testDb.select().from(mailWorkerJobs)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('pending')
    expect(jobs[0]?.requestedByUserId).toBe(admin.userId)

    // since should be ~7 days before "now" — sanity-check the relation, not
    // an exact timestamp that would race with wall clock drift.
    const sinceMs = jobs[0]?.since?.getTime() ?? -1
    const sevenDaysMs = 7 * 24 * 3600 * 1000
    const now = Date.now()
    expect(sinceMs).toBeGreaterThanOrEqual(now - sevenDaysMs - 60_000)
    expect(sinceMs).toBeLessThanOrEqual(now - sevenDaysMs + 60_000)

    await context.close()
  })

  test('履歴 0 件のとき空メッセージが表示される', async ({ browser }) => {
    const admin = await seedAdminSession({ name: 'Admin History Empty' })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto('/admin/mail-inbox')
    await expect(page.getByText('まだ実行履歴がありません')).toBeVisible()

    // Verify lookup still works after revalidate by ensuring no rows leak in.
    const runs = await testDb
      .select()
      .from(mailWorkerRuns)
      .where(eq(mailWorkerRuns.kind, 'cron'))
    expect(runs).toHaveLength(0)

    await context.close()
  })
})
