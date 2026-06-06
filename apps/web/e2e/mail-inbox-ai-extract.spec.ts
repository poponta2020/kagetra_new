import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import {
  mailWorkerJobs,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import { createMailMessage } from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * mail-inbox-mailer タスク7: 「会で流す（AI 抽出）」確認ダイアログ → triggerExtractDraft
 * のフロントエンド連動を end-to-end で確認する。
 *
 * DOM 契約:
 *   - 未処理 + draft なしの mail 詳細画面に「会で流す（AI 抽出）」ボタンが出る
 *   - ボタン押下で確認ダイアログが開く
 *   - 「はい」で tournament_drafts INSERT (status='ai_processing') と
 *     mail_worker_jobs INSERT (kind='manual_extract', payload={mail_message_id})
 *   - 完了後の画面再取得で ExtractionInProgressCard 表示に切り替わる
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

test.describe('mail-inbox-mailer: AI extract trigger', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('「会で流す」→ 確認 →「はい」で draft (ai_processing) + manual_extract job が作られる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Inbox Admin' })
    const mail = await createMailMessage({
      subject: '【ご案内】第99回テスト大会',
      bodyText: 'テストの本文です。',
      triageStatus: 'unprocessed',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/mail/${mail.id}`)

    // mail-inbox-mailer: 本文は details トグルではなく即時表示。
    await expect(page.getByText('テストの本文です。')).toBeVisible()

    // 3 ボタンが揃って出る。
    const triggerButton = page.getByRole('button', { name: '会で流す（AI 抽出）' })
    await expect(triggerButton).toBeVisible()
    await expect(page.getByRole('button', { name: '既存イベントに紐付ける' })).toBeVisible()
    await expect(page.getByRole('button', { name: '対応不要' })).toBeVisible()

    // 確認ダイアログ → 「はい」
    await triggerButton.click()
    await expect(page.getByText('AI で抽出します')).toBeVisible()
    await page.getByRole('button', { name: 'はい' }).click()

    // ExtractionInProgressCard が表示される（refresh 後）。
    await expect(page.getByText('AI 抽出中…')).toBeVisible()

    // DB を直接覗いて Server Action の副作用を verify。
    const drafts = await testDb
      .select()
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.messageId, mail.id))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.status).toBe('ai_processing')

    const jobs = await testDb
      .select()
      .from(mailWorkerJobs)
      .where(eq(mailWorkerJobs.kind, 'manual_extract'))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.payload).toEqual({ mail_message_id: mail.id })
    expect(jobs[0]!.requestedByUserId).toBe(admin.user.id)

    await context.close()
  })

  test('「いいえ」を押せば draft も job も作らずダイアログだけ閉じる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Inbox Admin' })
    const mail = await createMailMessage({
      subject: '別件メール',
      triageStatus: 'unprocessed',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/mail/${mail.id}`)
    await page.getByRole('button', { name: '会で流す（AI 抽出）' }).click()
    await page.getByRole('button', { name: 'いいえ' }).click()

    await expect(page.getByText('AI で抽出します')).not.toBeVisible()

    const drafts = await testDb
      .select()
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.messageId, mail.id))
    expect(drafts).toHaveLength(0)

    const jobs = await testDb.select().from(mailWorkerJobs)
    expect(jobs).toHaveLength(0)

    await context.close()
  })
})
