import { expect, test } from '@playwright/test'
import { lineChannels } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { testDb, truncateAll } from '../src/test-utils/db'

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

async function seedBots(
  bots: { note: string; status: 'available' | 'assigned' | 'active' | 'disabled' }[],
) {
  for (const bot of bots) {
    await testDb.insert(lineChannels).values({
      channelId: `ch-${bot.note}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: `@${bot.note}`,
      purpose: 'event_broadcast',
      status: bot.status,
      note: bot.note,
    })
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('/admin/line-channels Bot プール管理', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('admin は 30 Bot 一覧が見られて、フィルタリンクでステータス絞り込みできる', async ({ context, page }) => {
    await seedBots([
      { note: 'kagetra-event-bot-1', status: 'available' },
      { note: 'kagetra-event-bot-2', status: 'available' },
      { note: 'kagetra-event-bot-3', status: 'active' },
      { note: 'kagetra-event-bot-4', status: 'disabled' },
    ])
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto('/admin/line-channels')
    await expect(page.getByRole('heading', { name: 'LINE 配信 Bot 管理' })).toBeVisible()
    // All 4 rows visible.
    await expect(page.getByText('kagetra-event-bot-1')).toBeVisible()
    await expect(page.getByText('kagetra-event-bot-3')).toBeVisible()
    await expect(page.getByText('kagetra-event-bot-4')).toBeVisible()

    // 「配信中」フィルタは active 1 件のみ。Click is robust to URL changes
    // because the page is a Server Component re-rendered on navigation.
    await page.getByRole('link', { name: '配信中' }).click()
    await expect(page).toHaveURL(/status=active/)
    await expect(page.getByText('kagetra-event-bot-3')).toBeVisible()
    await expect(page.getByText('kagetra-event-bot-1')).not.toBeVisible()
  })

  test('一般会員は /admin/line-channels にアクセスできず /403 にリダイレクトされる', async ({ context, page }) => {
    await seedBots([{ note: 'kagetra-event-bot-1', status: 'available' }])
    const session = await seedMemberSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto('/admin/line-channels')
    await expect(page).toHaveURL(/\/403/)
  })

  test('Bot 詳細ページが開ける', async ({ context, page }) => {
    await seedBots([{ note: 'kagetra-event-bot-99', status: 'available' }])
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto('/admin/line-channels')
    await page.getByRole('link', { name: '詳細' }).first().click()
    await expect(page.getByRole('heading', { name: 'kagetra-event-bot-99' })).toBeVisible()
    // Manual link is offered for non-disabled bots.
    await expect(page.getByRole('button', { name: '手動紐付け' })).toBeVisible()
  })
})
