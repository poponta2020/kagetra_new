import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import {
  events,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
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

  // entry-notify-lottery-treasurer (タスク5 E2E) ----------------------------
  test('admin: /edit で抽選日を保存→/events/[id] で表示→申込済トグルが例外なく完了（2 種別とも once-ever）', async ({
    context,
    page,
  }) => {
    const event = await seedLinkedEvent('抽選E2E')
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    // 1) 編集画面で抽選日を入力 → 保存
    await page.goto(`/events/${event.id}/edit`)
    await page.locator('input[name="lotteryDate"]').fill('2026-01-20')
    await page.getByRole('button', { name: '更新' }).click()
    await page.waitForURL(`**/events/${event.id}`)

    // 2) 詳細画面に抽選日が表示される（参加費・締切と並ぶ参照行）
    await expect(page.getByText('抽選日', { exact: true })).toBeVisible()
    await expect(page.getByText('2026-01-20', { exact: true })).toBeVisible()

    // 3) 申込済トグル — linked 大会なので確認ダイアログを accept
    page.on('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '申込済にする' }).click()
    await expect(page.getByRole('button', { name: '未申込に戻す' })).toBeVisible()

    // 4) DB: entry_applied と entry_applied_treasurer の 2 種別ログが作成される
    //    （DRY_RUN 下では push は飛ばないが claim → finalize は走るので sent で記録される）
    const logs = await testDb
      .select()
      .from(eventLifecycleNotifications)
      .where(eq(eventLifecycleNotifications.eventId, event.id))
    expect(logs).toHaveLength(2)
    expect(new Set(logs.map((l) => l.type))).toEqual(
      new Set(['entry_applied', 'entry_applied_treasurer']),
    )
  })

  test('一般会員: 抽選日が参照のみで表示される（編集導線は出ない）', async ({ context, page }) => {
    const event = await createEvent({
      title: '会員抽選参照E2E',
      eventDate: '2026-12-01',
      lotteryDate: '2026-01-20',
    })
    const session = await seedMemberSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    await expect(page.getByText('抽選日', { exact: true })).toBeVisible()
    await expect(page.getByText('2026-01-20', { exact: true })).toBeVisible()
    // 編集導線は admin/vice_admin のみ（会員には出ない）
    await expect(page.getByRole('link', { name: '編集' })).toHaveCount(0)
  })
})
