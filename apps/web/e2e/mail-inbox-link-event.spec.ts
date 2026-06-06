import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { mailMessages } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import { createEvent, createMailMessage } from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * mail-inbox-mailer タスク7: 「既存イベントに紐付ける」シートのフロント連動を
 * end-to-end で確認する。
 *
 * フロー:
 *   1. mail 詳細を開く → 「既存イベントに紐付ける」を押す
 *   2. シートに候補（未開催 + 過去 30 日）が並ぶ
 *   3. 選択 → 「結びつける」→ linkMailToEvent → /admin/mail-inbox に戻る
 *   4. DB を確認:
 *      - mail_messages.linked_event_id = ev.id
 *      - triage_status='processed'
 *      - triaged_at / triaged_by_user_id がセット
 *
 * LINE 配信は after() で発火するが、テスト DB 環境では LINE channel binding が
 * 無いので broadcastMailToEvent は早期 return（skipped）して terminating すれば
 * よい。配信成功までは DB 状態としては確認しない（タスク3 の Vitest で hook を
 * spy したのと役割を分ける）。
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

test.describe('mail-inbox-mailer: link mail to existing event', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('既存イベント結びつけシート → 紐付け → triage=processed + linked_event_id 確定', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Link Admin' })

    // 未開催の event を 1 件用意（候補に出る範囲）。
    const event = await createEvent({
      title: '結びつけ先大会 A',
      eventDate: '2099-12-01',
      status: 'published',
    })

    const mail = await createMailMessage({
      subject: '【補足】組合せ表',
      bodyText: '組合せ表 v1 です。',
      triageStatus: 'unprocessed',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/mail/${mail.id}`)

    // シート起動。
    await page.getByRole('button', { name: '既存イベントに紐付ける' }).click()

    // 候補に target event のタイトルが出る。
    const optionLabel = page.locator('label', { hasText: '結びつけ先大会 A' })
    await expect(optionLabel).toBeVisible()
    await optionLabel.locator('input[type=radio]').check()

    // 「結びつける」押下で /admin/mail-inbox に遷移。
    await page.getByRole('button', { name: '結びつける' }).click()
    await page.waitForURL('**/admin/mail-inbox')

    // DB 状態を verify。
    const after = await testDb
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, mail.id))
    expect(after).toHaveLength(1)
    expect(after[0]!.linkedEventId).toBe(event.id)
    expect(after[0]!.triageStatus).toBe('processed')
    expect(after[0]!.triagedByUserId).toBe(admin.user.id)
    expect(after[0]!.triagedAt).not.toBeNull()

    await context.close()
  })
})
