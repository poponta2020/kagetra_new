import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { events, eventLineBroadcasts, lineChannels } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
  seedMemberSession,
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

async function seedLinkedEvent(title: string) {
  const event = await createEvent({ title, eventDate: '2026-12-01' })
  const unique = Math.random().toString(36).slice(2, 8)
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${unique}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: `@bot-${unique}`,
      purpose: 'event_broadcast',
      status: 'active',
      note: `bot-${unique}`,
      assignedEventId: event.id,
    })
    .returning()
  if (!channel) throw new Error('failed to seed channel')
  await testDb.insert(eventLineBroadcasts).values({
    eventId: event.id,
    lineChannelId: channel.id,
    status: 'linked',
    lineGroupId: 'Ge2e',
    linkedAt: new Date(),
  })
  return event
}

test.describe.configure({ mode: 'serial' })

test.describe('/events/[id] 進行管理セクション', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('admin: 未紐付け大会は確認なしで申込済にトグルできる', async ({ context, page }) => {
    const event = await createEvent({ title: 'E2E申込トグル', eventDate: '2026-12-01' })
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    await expect(page.getByText('進行管理', { exact: true })).toBeVisible()
    await expect(page.getByText(/通知は送られません/)).toBeVisible()

    await page.getByRole('button', { name: '申込済にする' }).click()
    // After revalidatePath the server re-renders and the label flips.
    await expect(page.getByRole('button', { name: '未申込に戻す' })).toBeVisible()

    const row = await testDb.query.events.findFirst({ where: eq(events.id, event.id) })
    expect(row?.entryStatus).toBe('applied')
  })

  test('admin: linked 大会は確認ダイアログを経て申込済になる', async ({ context, page }) => {
    const event = await seedLinkedEvent('紐付けE2E')
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)

    let dialogMessage = ''
    page.on('dialog', (dialog) => {
      dialogMessage = dialog.message()
      void dialog.accept()
    })

    await page.getByRole('button', { name: '申込済にする' }).click()
    await expect(page.getByRole('button', { name: '未申込に戻す' })).toBeVisible()
    expect(dialogMessage).toContain('通知が送られます')

    const row = await testDb.query.events.findFirst({ where: eq(events.id, event.id) })
    expect(row?.entryStatus).toBe('applied')
  })

  test('一般会員: 参照バッジのみでトグルボタンは出ない', async ({ context, page }) => {
    const event = await createEvent({ title: '会員参照E2E', eventDate: '2026-12-01' })
    const session = await seedMemberSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    await expect(page.getByText('進行状況', { exact: true })).toBeVisible()
    await expect(page.getByText('未申込')).toBeVisible()
    await expect(page.getByRole('button', { name: '申込済にする' })).toHaveCount(0)
  })
})
