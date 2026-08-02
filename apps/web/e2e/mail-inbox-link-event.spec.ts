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
 * mail-inbox-mailer 2026-08-02 改修: **統合処理フォーム**で「種別 = 未選択 のまま
 * 大会に紐付けて実行する」フローを end-to-end で確認する（旧「既存イベントに
 * 紐付ける」シートの置き換え）。
 *
 * フロー:
 *   1. mail 詳細を開く（種別セグメントの既定は「未選択」）
 *   2. 「大会を選ぶ」→ ボトムシートに申込グループ候補が並ぶ
 *   3. 選択 →「決定」→ 選択済みチップに変わる
 *   4. 「実行する」→ processMail → /admin/mail-inbox に戻る
 *   5. DB を確認:
 *      - mail_messages.linked_event_id = 代表イベント
 *      - mail_kind は NULL のまま（未選択）
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

test.describe('mail-inbox-mailer: 統合処理フォームで大会に紐付ける', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('大会を選ぶ → 実行する → triage=processed + linked_event_id 確定', async ({
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

    // 種別の既定は「未選択」。そのまま「大会を選ぶ」でボトムシートを開く。
    await page.getByRole('button', { name: '大会を選ぶ' }).click()

    // 候補に target group（表示名 = イベントのタイトル由来）が出る。
    const optionLabel = page.locator('label', { hasText: '結びつけ先大会 A' })
    await expect(optionLabel).toBeVisible()
    await optionLabel.locator('input[type=radio]').check()
    await page.getByRole('button', { name: '決定' }).click()

    // 「実行する」押下で /admin/mail-inbox に遷移。
    await page.getByRole('button', { name: '実行する' }).click()
    await page.waitForURL('**/admin/mail-inbox')

    // DB 状態を verify。
    const after = await testDb
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, mail.id))
    expect(after).toHaveLength(1)
    expect(after[0]!.linkedEventId).toBe(event.id)
    // 種別は「未選択」のまま保存される（AC-1: 未選択 = その他）。
    expect(after[0]!.mailKind).toBeNull()
    expect(after[0]!.triageStatus).toBe('processed')
    expect(after[0]!.triagedByUserId).toBe(admin.userId)
    expect(after[0]!.triagedAt).not.toBeNull()

    await context.close()
  })
})
