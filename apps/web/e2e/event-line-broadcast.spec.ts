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

    await page.getByRole('button', { name: 'LINE 配信を有効化' }).click()
    // Modal heading "招待コード"
    await expect(page.getByRole('heading', { name: '招待コード' })).toBeVisible()
    // 6-digit code rendered with letter-spacing-heavy class — match any 6 digit run.
    await expect(page.getByText(/\d{6}/)).toBeVisible()

    const broadcast = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.eventId, event.id),
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
    await page.getByRole('button', { name: 'LINE 配信を有効化' }).click()

    // The section's error pane renders the server-side message; we look for
    // the unique "Bot プール" phrase so the assertion is stable across
    // wording tweaks of the punctuation.
    await expect(page.getByText(/Bot プール/)).toBeVisible()
  })
})
