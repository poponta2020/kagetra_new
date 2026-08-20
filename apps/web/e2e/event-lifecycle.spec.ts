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
      assignedEntryGroupId: event.entryGroupId,
    })
    .returning()
  if (!channel) throw new Error('failed to seed channel')
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId: event.entryGroupId,
    lineChannelId: channel.id,
    status: 'linked',
    lineGroupId: 'Ge2e',
    linkedAt: new Date(),
  })
  return event
}

test.describe.configure({ mode: 'serial' })

/**
 * event-detail-redesign: 運営操作は `<details>`（既定=閉）に畳まれた。中の
 * ボタンは閉じている間 not visible なので、クリック前に summary を開く。
 */
async function openToggle(page: import('@playwright/test').Page, label: string) {
  await page.locator('summary').filter({ hasText: label }).first().click()
}

/** 申込状態トグルの summary（進行管理を開いている間だけ見える現在値）。 */
function entrySummary(page: import('@playwright/test').Page) {
  return page.locator('summary').filter({ hasText: '申込状態' }).first()
}

/**
 * 日程表の行に出る進行フェーズ1語（entry-group-page）。既定=閉の `<details>` の
 * 外にあるので、保存後の開閉状態に左右されずに状態遷移を確認できる。
 */
function dayPhase(page: import('@playwright/test').Page, label: string) {
  return page.getByText(label, { exact: true })
}

/**
 * entry-group-page: 進行管理と一括操作は `/admin/entries/[groupId]`（申込グループ
 * ページ）へ移設された。日ページ `/events/[id]` に残るのは会員向けの情報だけ。
 */
test.describe('進行管理セクション（/admin/entries/[groupId] へ移設）', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('admin: 未紐付け大会は確認なしで申込済にトグルできる', async ({ context, page }) => {
    const event = await createEvent({ title: 'E2E申込トグル', eventDate: '2026-12-01' })
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/admin/entries/${event.entryGroupId}`)
    await expect(page.getByText('進行管理', { exact: true })).toBeVisible()
    // 「LINE グループ未紐付けのため通知は送られません」の注記は廃止された
    // （event-detail-redesign requirements §3.2.3(b)）。
    await expect(page.getByText(/通知は送られません/)).toHaveCount(0)
    // 締切未設定・未申込なので日程表のフェーズは「締切前」。
    await expect(dayPhase(page, '締切前')).toBeVisible()

    // 進行管理は表示専用（トグルを持たない）。現在値の確認だけ行う。
    await openToggle(page, '進行管理')
    await expect(entrySummary(page)).toContainText('未申込')

    // 状態の切り替えは日程表の一括操作バー。既定で選択可能な日は全チェック済み。
    await page.getByRole('button', { name: '申込済にする' }).click()
    // 支払タイプ未設定なので applied になった時点でフェーズは「完了」へ進む。
    // `<details>` の開閉状態に依存しない位置で確認する。
    await expect(dayPhase(page, '完了')).toBeVisible()

    const row = await testDb.query.events.findFirst({ where: eq(events.id, event.id) })
    expect(row?.entryStatus).toBe('applied')
  })

  test('admin: linked 大会は確認ダイアログを経て申込済になる', async ({ context, page }) => {
    const event = await seedLinkedEvent('紐付けE2E')
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/admin/entries/${event.entryGroupId}`)

    let dialogMessage = ''
    page.on('dialog', (dialog) => {
      dialogMessage = dialog.message()
      void dialog.accept()
    })

    await page.getByRole('button', { name: '申込済にする' }).click()
    await expect(dayPhase(page, '完了')).toBeVisible()
    expect(dialogMessage).toContain('通知が送られます')

    const row = await testDb.query.events.findFirst({ where: eq(events.id, event.id) })
    expect(row?.entryStatus).toBe('applied')
  })

  test('一般会員: 進行管理セクションごと出ず、申込フローで段階を見る', async ({ context, page }) => {
    const event = await createEvent({ title: '会員参照E2E', eventDate: '2026-12-01' })
    const session = await seedMemberSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    // 読み取り専用の進行状況バッジは廃止し、申込フローが役割を引き継いだ
    // （requirements §3.2.3(a)）。
    await expect(page.getByText('進行状況', { exact: true })).toHaveCount(0)
    await expect(page.getByText('進行管理', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '申込済にする' })).toHaveCount(0)
    // 申込フローは両ビュー共通で 5 ステップを常に描く。
    for (const step of ['会内締切', '大会申込', '抽選', '支払', '開催']) {
      await expect(page.getByText(step, { exact: true })).toBeVisible()
    }
  })

  // entry-notify-lottery-treasurer (タスク5 E2E) ----------------------------
  test('admin: 共通項目で抽選日を保存→/events/[id] で表示→申込済にして 2 種別とも once-ever', async ({
    context,
    page,
  }) => {
    const event = await seedLinkedEvent('抽選E2E')
    const session = await seedAdminSession()
    await addSessionCookie(context, session.sessionToken)

    // 1) entry-group-page: 抽選日はグループ共通の7項目なので、日ページの編集
    //    フォームから撤去され、グループページの「共通項目」で全日へ一括保存する。
    await page.goto(`/admin/entries/${event.entryGroupId}`)
    await openToggle(page, '共通項目')
    await page.getByRole('button', { name: '編集' }).click()
    await page.locator('input[name="lotteryDate"]').fill('2026-01-20')
    await page.getByRole('button', { name: /全\d+日へ保存/ }).click()
    // 保存後は表示に戻り、共通項目の表へ M/D 表記で反映される。
    await expect(page.getByRole('button', { name: '編集' })).toBeVisible()

    // 2) 日ページの申込フロー「抽選」ステップに日付が出る。旧「抽選日」参照行は
    //    詳細表ごと廃止され、日付は生 ISO ではなく M/D 表記になった（AC-22）。
    await page.goto(`/events/${event.id}`)
    await expect(page.getByText('抽選', { exact: true })).toBeVisible()
    await expect(page.getByText('1/20', { exact: true })).toBeVisible()
    await expect(page.getByText('2026-01-20')).toHaveCount(0)

    // 3) 申込済にする — linked 大会なので確認ダイアログを accept
    page.on('dialog', (dialog) => void dialog.accept())
    await page.goto(`/admin/entries/${event.entryGroupId}`)
    await page.getByRole('button', { name: '申込済にする' }).click()
    // 抽選日が過去でなく確定名簿も無いので、applied 後のフェーズは「抽選待ち」
    // …ではなく支払タイプ未設定のため「完了」になる（classify の評価順）。
    await expect(dayPhase(page, '完了')).toBeVisible()

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

  test('一般会員: 抽選日が申込フローに出る（編集導線は出ない）', async ({ context, page }) => {
    const event = await createEvent({
      title: '会員抽選参照E2E',
      eventDate: '2026-12-01',
      lotteryDate: '2026-01-20',
    })
    const session = await seedMemberSession()
    await addSessionCookie(context, session.sessionToken)

    await page.goto(`/events/${event.id}`)
    await expect(page.getByText('抽選', { exact: true })).toBeVisible()
    await expect(page.getByText('1/20', { exact: true })).toBeVisible()
    // 生 ISO 表記は画面に出さない（AC-22）。
    await expect(page.getByText('2026-01-20')).toHaveCount(0)
    // 編集導線は admin/vice_admin のみ（会員には出ない）
    await expect(page.getByRole('link', { name: '編集' })).toHaveCount(0)
  })
})
