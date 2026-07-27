import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { eventLineBroadcasts, lineChannels } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import { createEvent } from '../src/test-utils/seed'
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

async function seedEventBroadcastChannel(status: 'available' | 'assigned' | 'active' = 'available') {
  const unique = Math.random().toString(36).slice(2, 8)
  const [row] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-test-${unique}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: `@kagetra-event-bot-${unique}`,
      purpose: 'event_broadcast',
      status,
      note: `kagetra-event-bot-${unique}`,
    })
    .returning()
  if (!row) throw new Error('failed to seed event_broadcast channel')
  return row
}

test.describe.configure({ mode: 'serial' })

/**
 * event-detail-redesign: LINE 配信は `<details>`（既定=閉）に畳まれた。中の
 * 「LINE 配信を有効化」は閉じている間 not visible なので、先に開く。
 */
async function openLineBroadcastToggle(page: import('@playwright/test').Page) {
  await page.locator('summary').filter({ hasText: 'LINE 配信' }).first().click()
}

test.describe('/events/[id] LINE 配信セクション', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('admin が「LINE 配信を有効化」を押すと invite_pending 行が作られて招待コードモーダルが表示される', async ({ context, page }) => {
    await seedEventBroadcastChannel('available')
    const event = await createEvent({ title: 'E2Eテスト大会', eventDate: '2026-12-01' })
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    await expect(page.getByRole('heading', { name: 'E2Eテスト大会' })).toBeVisible()

    await openLineBroadcastToggle(page)
    await page.getByRole('button', { name: 'LINE 配信を有効化' }).click()
    // Modal heading "招待コード"
    await expect(page.getByRole('heading', { name: '招待コード' })).toBeVisible()
    // 6-digit code rendered with letter-spacing-heavy class. Anchor to an exact
    // 6-digit text node: a bare /\d{6}/ also matched the app-bar username
    // (test-user-<uuid>さん) whenever the seeded UUID held a 6-digit run, causing
    // a flaky strict-mode violation (resolved to 2 elements).
    await expect(page.getByText(/^\d{6}$/)).toBeVisible()

    const broadcast = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, event.entryGroupId),
    })
    expect(broadcast?.status).toBe('invite_pending')
    expect(broadcast?.inviteCode).toMatch(/^\d{6}$/)
    expect(broadcast?.inviteCodeExpiresAt).not.toBeNull()
  })

  test('Bot プールが空のときはエラーメッセージが出る', async ({ context, page }) => {
    // No event_broadcast channels seeded → generation should fail.
    const event = await createEvent({ title: '枯渇テスト', eventDate: '2026-12-15' })
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    await openLineBroadcastToggle(page)
    await page.getByRole('button', { name: 'LINE 配信を有効化' }).click()

    // The section's error pane renders the server-side message; we look for
    // the unique "Bot プール" phrase so the assertion is stable across
    // wording tweaks of the punctuation.
    await expect(page.getByText(/Bot プール/)).toBeVisible()
  })
})
