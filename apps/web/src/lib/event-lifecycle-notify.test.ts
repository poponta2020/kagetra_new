import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  eventLifecycleNotificationTypeEnum,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent } from '@/test-utils/seed'
import {
  addDaysIso,
  buildLifecycleMessage,
  claimLifecycleNotification,
  finalizeLifecycleNotification,
  formatFeeAmount,
  formatMMDD,
  jstTodayIso,
  loadLinkedBinding,
  pushTextToEventGroup,
  reminderLeadDays,
  sendClaimedNotificationBulk,
  sendReminderNotification,
} from './event-lifecycle-notify'

// ---------------------------------------------------------------------------
// Pure unit tests (no DB)
// ---------------------------------------------------------------------------

describe('buildLifecycleMessage', () => {
  const title = '春の大会'

  it('申込完了 (✅) — 抽選日なしは従来どおり', () => {
    expect(buildLifecycleMessage('entry_applied', { title })).toBe(
      '✅【春の大会】への参加申込が完了しました。',
    )
  })

  it('申込完了 (✅) — lotteryDateIso 非 null で末尾に「抽選日は M/D です」を追記', () => {
    expect(
      buildLifecycleMessage('entry_applied', { title, lotteryDateIso: '2026-01-20' }),
    ).toBe('✅【春の大会】への参加申込が完了しました。\n抽選日は 1/20 です。')
  })

  it('申込完了 (✅) — lotteryDateIso が null/空文字なら追記なし', () => {
    expect(buildLifecycleMessage('entry_applied', { title, lotteryDateIso: null })).toBe(
      '✅【春の大会】への参加申込が完了しました。',
    )
    expect(buildLifecycleMessage('entry_applied', { title, lotteryDateIso: '' })).toBe(
      '✅【春の大会】への参加申込が完了しました。',
    )
  })

  it('会計向け (💴) — 期限のみ', () => {
    expect(
      buildLifecycleMessage('entry_applied_treasurer', {
        title,
        paymentDeadlineIso: '2026-01-25',
      }),
    ).toBe('💴【春の大会】会計の方へ\n振込期限：1/25')
  })

  it('会計向け (💴) — 方法のみ', () => {
    expect(
      buildLifecycleMessage('entry_applied_treasurer', {
        title,
        paymentMethod: '銀行振込',
      }),
    ).toBe('💴【春の大会】会計の方へ\n振込方法：銀行振込')
  })

  it('会計向け (💴) — 期限・方法・詳細すべてあり', () => {
    expect(
      buildLifecycleMessage('entry_applied_treasurer', {
        title,
        paymentDeadlineIso: '2026-01-25',
        paymentMethod: '銀行振込',
        paymentInfo: '◯◯銀行 △△支店 普通 1234567',
      }),
    ).toBe(
      '💴【春の大会】会計の方へ\n振込期限：1/25\n振込方法：銀行振込\n◯◯銀行 △△支店 普通 1234567',
    )
  })

  it('会計向け (💴) — 全項目空なら最小文面', () => {
    expect(buildLifecycleMessage('entry_applied_treasurer', { title })).toBe(
      '💴【春の大会】会計の方へ\n参加費の振込手続きをお願いします。振込方法・期限は大会ページでご確認ください。',
    )
  })

  it('会計向け (💴) — 空白のみの method/info は無視（最小文面に落ちる）', () => {
    expect(
      buildLifecycleMessage('entry_applied_treasurer', {
        title,
        paymentMethod: '   ',
        paymentInfo: '\n  \t',
      }),
    ).toBe(
      '💴【春の大会】会計の方へ\n参加費の振込手続きをお願いします。振込方法・期限は大会ページでご確認ください。',
    )
  })

  it('会計向け (💴) — feeJpy を渡しても金額は文面に出ない（会計は合計振込のため）', () => {
    const msg = buildLifecycleMessage('entry_applied_treasurer', {
      title,
      feeJpy: 1500,
      paymentDeadlineIso: '2026-01-25',
    })
    expect(msg).not.toContain('1,500')
    expect(msg).not.toContain('1500')
    expect(msg).not.toContain('円')
  })

  it('申込締切・事前 (⏰) は MM/DD とリードタイムを差し込む', () => {
    expect(
      buildLifecycleMessage('entry_deadline_advance', {
        title,
        dateIso: '2026-06-05',
        leadDays: 3,
      }),
    ).toBe('⏰【春の大会】の申込締切は 6/5（あと 3 日）です。まだ申込が完了していません。')
  })

  it('申込締切・当日 (⚠️)', () => {
    expect(
      buildLifecycleMessage('entry_deadline_day', { title, dateIso: '2026-06-05' }),
    ).toBe('⚠️【春の大会】の申込締切は本日 6/5 です。まだ申込が完了していません。')
  })

  it('支払完了 (✅) は金額ありで（円）を付ける', () => {
    expect(buildLifecycleMessage('payment_paid', { title, feeJpy: 1000 })).toBe(
      '✅【春の大会】の参加費（1,000円）の支払いが完了しました。',
    )
  })

  it('支払完了 (✅) は金額 NULL で金額部分を省略する', () => {
    expect(buildLifecycleMessage('payment_paid', { title, feeJpy: null })).toBe(
      '✅【春の大会】の参加費の支払いが完了しました。',
    )
  })

  it('支払締切・事前 (⏰)', () => {
    expect(
      buildLifecycleMessage('payment_deadline_advance', {
        title,
        dateIso: '2026-06-10',
        leadDays: 3,
      }),
    ).toBe('⏰【春の大会】の参加費の支払締切は 6/10（あと 3 日）です。まだ支払いが完了していません。')
  })

  it('支払締切・当日 (⚠️)', () => {
    expect(
      buildLifecycleMessage('payment_deadline_day', { title, dateIso: '2026-06-10' }),
    ).toBe('⚠️【春の大会】の参加費の支払締切は本日 6/10 です。まだ支払いが完了していません。')
  })

  it('現地払い・事前 (💰) は金額ありで当日持参を促す', () => {
    expect(
      buildLifecycleMessage('onsite_payment_advance', {
        title,
        feeJpy: 1500,
        dateIso: '2026-06-20',
      }),
    ).toBe('💰【春の大会】は当日現地払いです。参加費 1,500円 を 6/20 当日お持ちください。')
  })

  it('現地払い・事前 (💰) は金額 NULL で金額を省略する', () => {
    expect(
      buildLifecycleMessage('onsite_payment_advance', { title, feeJpy: null, dateIso: '2026-06-20' }),
    ).toBe('💰【春の大会】は当日現地払いです。参加費を 6/20 当日お持ちください。')
  })

  it('現地払い・当日 (💰) は金額ありで現地払いを念押し', () => {
    expect(buildLifecycleMessage('onsite_payment_day', { title, feeJpy: 1500 })).toBe(
      '💰 本日は【春の大会】です。現地払い 1,500円 をお忘れなく。',
    )
  })

  it('現地払い・当日 (💰) は金額 NULL でも自然な文面', () => {
    expect(buildLifecycleMessage('onsite_payment_day', { title, feeJpy: null })).toBe(
      '💰 本日は【春の大会】です。参加費の現地払いをお忘れなく。',
    )
  })

  it('全 9 種別が title を含む非空メッセージを返す（branch 漏れ検出）', () => {
    // entry_applied_treasurer も title 行を含む（最小文面に落ちても見出しの【title】会計の方へ が出る）。
    expect(eventLifecycleNotificationTypeEnum.enumValues.length).toBe(9)
    for (const type of eventLifecycleNotificationTypeEnum.enumValues) {
      const msg = buildLifecycleMessage(type, { title, feeJpy: 800, dateIso: '2026-06-05' })
      expect(msg).toContain('春の大会')
      expect(msg.length).toBeGreaterThan(5)
    }
  })

  it('leadDays 省略時は reminderLeadDays() 既定値を使う', () => {
    const msg = buildLifecycleMessage('entry_deadline_advance', {
      title,
      dateIso: '2026-06-05',
    })
    expect(msg).toContain('あと 3 日')
  })
})

// ---------------------------------------------------------------------------
// entry-groups タスク4: buildLifecycleMessage の複数日拡張（AC-8/9/10）。
// ---------------------------------------------------------------------------
describe('buildLifecycleMessage — 複数日拡張（entry-groups タスク4）', () => {
  it('entry_applied: days が1件のときは既存の単一日ロジックへ流れる（days は無視）', () => {
    // ctx.title を渡さず days を1件だけ渡しても、multiDay 分岐（length > 1）には
    // 入らないため、単一日ロジックが title を使う（空文字になる）ことを固定する。
    // これにより「days.length<=1 は既存ロジック不変」という契約をテストで担保する。
    const withTitle = buildLifecycleMessage('entry_applied', {
      title: '単日大会',
      days: [{ dateIso: '2026-08-01', title: '単日大会' }],
    })
    expect(withTitle).toBe('✅【単日大会】への参加申込が完了しました。')
  })

  it('entry_applied: 2件以上は日別ラベルを・で連結する（開催日昇順に並べ替える）', () => {
    const msg = buildLifecycleMessage('entry_applied', {
      title: '',
      days: [
        { dateIso: '2026-08-08', title: 'D級' },
        { dateIso: '2026-08-01', title: 'C級' },
      ],
    })
    expect(msg).toBe('✅8/1(土)C級・8/8(土)D級の参加申込が完了しました。')
  })

  it('entry_applied: 複数日でも lotteryDateIso を渡せば単一日と同じ追記書式になる', () => {
    const msg = buildLifecycleMessage('entry_applied', {
      title: '',
      lotteryDateIso: '2026-08-15',
      days: [
        { dateIso: '2026-08-01', title: 'C級' },
        { dateIso: '2026-08-08', title: 'D級' },
      ],
    })
    expect(msg).toBe(
      '✅8/1(土)C級・8/8(土)D級の参加申込が完了しました。\n抽選日は 8/15 です。',
    )
  })

  it('entry_applied_treasurer: payment 系が全日同値なら1回だけ表記する', () => {
    const msg = buildLifecycleMessage('entry_applied_treasurer', {
      title: '',
      days: [
        {
          dateIso: '2026-08-01',
          title: 'C級',
          paymentDeadlineIso: '2026-07-25',
          paymentMethod: '銀行振込',
          paymentInfo: '◯◯銀行 普通 1234567',
        },
        {
          dateIso: '2026-08-08',
          title: 'D級',
          paymentDeadlineIso: '2026-07-25',
          paymentMethod: '銀行振込',
          paymentInfo: '◯◯銀行 普通 1234567',
        },
      ],
    })
    expect(msg).toBe(
      '💴8/1(土)C級・8/8(土)D級会計の方へ\n振込期限：7/25\n振込方法：銀行振込\n◯◯銀行 普通 1234567',
    )
  })

  it('entry_applied_treasurer: payment 系に差があれば日別行にする', () => {
    const msg = buildLifecycleMessage('entry_applied_treasurer', {
      title: '',
      days: [
        {
          dateIso: '2026-08-01',
          title: 'C級',
          paymentDeadlineIso: '2026-07-25',
          paymentMethod: '銀行振込',
        },
        {
          dateIso: '2026-08-08',
          title: 'D級',
          paymentDeadlineIso: '2026-08-01',
          paymentMethod: '現金書留',
        },
      ],
    })
    expect(msg).toBe(
      '💴8/1(土)C級・8/8(土)D級会計の方へ\n' +
        '8/1(土)C級\n振込期限：7/25\n振込方法：銀行振込\n\n' +
        '8/8(土)D級\n振込期限：8/1\n振込方法：現金書留',
    )
  })

  it('entry_applied_treasurer: 全日 payment 系が空なら1回だけ最小文面になる', () => {
    const msg = buildLifecycleMessage('entry_applied_treasurer', {
      title: '',
      days: [
        { dateIso: '2026-08-01', title: 'C級' },
        { dateIso: '2026-08-08', title: 'D級' },
      ],
    })
    expect(msg).toBe(
      '💴8/1(土)C級・8/8(土)D級会計の方へ\n参加費の振込手続きをお願いします。振込方法・期限は大会ページでご確認ください。',
    )
  })

  it('payment_paid: 2件以上は金額を出さず日別ラベルの列挙のみにする', () => {
    const msg = buildLifecycleMessage('payment_paid', {
      title: '',
      feeJpy: 2000,
      days: [
        { dateIso: '2026-08-08', title: 'D級' },
        { dateIso: '2026-08-01', title: 'C級' },
      ],
    })
    expect(msg).toBe('✅8/1(土)C級・8/8(土)D級の参加費の支払いが完了しました。')
  })
})

describe('date / fee helpers', () => {
  it('formatMMDD は先頭ゼロを落とす', () => {
    expect(formatMMDD('2026-06-05')).toBe('6/5')
    expect(formatMMDD('2026-12-25')).toBe('12/25')
  })

  it('formatFeeAmount は ja-JP 区切り + 円、NULL は null', () => {
    expect(formatFeeAmount(1000)).toBe('1,000円')
    expect(formatFeeAmount(12345)).toBe('12,345円')
    expect(formatFeeAmount(null)).toBeNull()
    expect(formatFeeAmount(undefined)).toBeNull()
  })

  it('jstTodayIso は JST 日付境界で切り替わる', () => {
    // 2026-05-31T15:00Z == JST 2026-06-01 00:00
    expect(jstTodayIso(new Date('2026-05-31T15:00:00Z'))).toBe('2026-06-01')
    // 2026-05-31T14:59Z == JST 2026-05-31 23:59
    expect(jstTodayIso(new Date('2026-05-31T14:59:00Z'))).toBe('2026-05-31')
  })

  it('addDaysIso は月・年跨ぎを正しく扱う', () => {
    expect(addDaysIso('2026-06-01', 3)).toBe('2026-06-04')
    expect(addDaysIso('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-06-05', 0)).toBe('2026-06-05')
  })

  it('reminderLeadDays は env override / 既定 3', () => {
    const original = process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS
    try {
      delete process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS
      expect(reminderLeadDays()).toBe(3)
      process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS = '5'
      expect(reminderLeadDays()).toBe(5)
      process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS = 'not-a-number'
      expect(reminderLeadDays()).toBe(3)
      process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS = '0'
      expect(reminderLeadDays()).toBe(3)
    } finally {
      if (original === undefined) delete process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS
      else process.env.EVENT_LIFECYCLE_REMINDER_LEAD_DAYS = original
    }
  })
})

// ---------------------------------------------------------------------------
// DB integration tests (LINE_NOTIFY_DRY_RUN=1 — no network)
// ---------------------------------------------------------------------------

async function seedLinkedEvent(opts: { lineGroupId?: string; token?: string } = {}) {
  const event = await createEvent({ title: 'Linked Event' })
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: opts.token ?? 'test-access-token',
      botId: '@test-bot',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: event.entryGroupId,
    })
    .returning()
  if (!channel) throw new Error('failed to seed channel')
  const [broadcast] = await testDb
    .insert(eventLineBroadcasts)
    .values({
      entryGroupId: event.entryGroupId,
      lineChannelId: channel.id,
      status: 'linked',
      lineGroupId: opts.lineGroupId ?? 'Gtest123',
      linkedAt: new Date(),
    })
    .returning()
  if (!broadcast) throw new Error('failed to seed broadcast')
  return { event, channel, broadcast }
}

describe('lifecycle notify — DB', () => {
  const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN

  beforeEach(async () => {
    process.env.LINE_NOTIFY_DRY_RUN = '1'
    await truncateAll()
  })
  afterAll(async () => {
    if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
    await closeTestDb()
  })

  it('loadLinkedBinding: 紐付けなしは null', async () => {
    const event = await createEvent({ title: 'Unlinked' })
    expect(await loadLinkedBinding(testDb, event.id)).toBeNull()
  })

  it('loadLinkedBinding: linked binding を token 込みで返す', async () => {
    const { event } = await seedLinkedEvent({ lineGroupId: 'Gabc', token: 'tok-1' })
    const binding = await loadLinkedBinding(testDb, event.id)
    expect(binding).toMatchObject({
      lineGroupId: 'Gabc',
      channelAccessToken: 'tok-1',
    })
  })

  it('pushTextToEventGroup: 紐付けなしは skipped（エラーではない）', async () => {
    const event = await createEvent({ title: 'Unlinked' })
    const result = await pushTextToEventGroup(testDb, event.id, 'hello')
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBe('no_linked_binding')
  })

  it('pushTextToEventGroup: DRY_RUN + linked は sent', async () => {
    const { event } = await seedLinkedEvent({ lineGroupId: 'Gsend' })
    const result = await pushTextToEventGroup(testDb, event.id, 'hello')
    expect(result.outcome).toBe('sent')
    expect(result.lineGroupId).toBe('Gsend')
  })

  it('claimLifecycleNotification: 同一 (event,type) は once-ever', async () => {
    const event = await createEvent({ title: 'Claim' })
    const first = await claimLifecycleNotification(testDb, event.id, 'entry_applied')
    expect(first.claimed).toBe(true)
    const second = await claimLifecycleNotification(testDb, event.id, 'entry_applied')
    expect(second.claimed).toBe(false)
    // 別種別は独立して claim できる
    const other = await claimLifecycleNotification(testDb, event.id, 'payment_paid')
    expect(other.claimed).toBe(true)

    const rows = await testDb
      .select()
      .from(eventLifecycleNotifications)
      .where(eq(eventLifecycleNotifications.eventId, event.id))
    expect(rows).toHaveLength(2)
  })

  it('finalizeLifecycleNotification: claim 行の status を更新する', async () => {
    const event = await createEvent({ title: 'Finalize' })
    const claim = await claimLifecycleNotification(testDb, event.id, 'entry_applied')
    await finalizeLifecycleNotification(testDb, claim.id!, {
      status: 'sent',
      lineGroupId: 'Gfin',
    })
    const row = await testDb.query.eventLifecycleNotifications.findFirst({
      where: eq(eventLifecycleNotifications.id, claim.id!),
    })
    expect(row).toMatchObject({ status: 'sent', lineGroupId: 'Gfin' })
  })

  it('sendReminderNotification: 初回 sent、再実行は UNIQUE で skipped（二重送信なし）', async () => {
    const { event } = await seedLinkedEvent({ lineGroupId: 'Grem' })
    const message = buildLifecycleMessage('entry_deadline_day', {
      title: event.title,
      dateIso: '2026-06-05',
    })

    const first = await sendReminderNotification(testDb, {
      eventId: event.id,
      type: 'entry_deadline_day',
      message,
    })
    expect(first.outcome).toBe('sent')

    const second = await sendReminderNotification(testDb, {
      eventId: event.id,
      type: 'entry_deadline_day',
      message,
    })
    expect(second.outcome).toBe('skipped')
    expect(second.reason).toBe('already_notified')

    // 行は 1 件のみ、status='sent'、送信先 group を記録
    const rows = await testDb
      .select()
      .from(eventLifecycleNotifications)
      .where(
        and(
          eq(eventLifecycleNotifications.eventId, event.id),
          eq(eventLifecycleNotifications.type, 'entry_deadline_day'),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'sent', lineGroupId: 'Grem' })
  })

  it('sendReminderNotification: 紐付けなしは slot を消費し skipped を記録（バックフィル防止）', async () => {
    const event = await createEvent({ title: 'NoBindingReminder' })
    const result = await sendReminderNotification(testDb, {
      eventId: event.id,
      type: 'entry_deadline_day',
      message: 'x',
    })
    expect(result.outcome).toBe('skipped')
    const row = await testDb.query.eventLifecycleNotifications.findFirst({
      where: eq(eventLifecycleNotifications.eventId, event.id),
    })
    // slot は消費済み（status='skipped'）→ 後から linked になっても再送しない
    expect(row).toMatchObject({ status: 'skipped' })
  })

  it('sendClaimedNotificationBulk: 1回の push 結果を複数の claim id へまとめて finalize する', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const day1 = await createEvent({
      title: 'C級',
      eventDate: '2026-08-01',
      entryGroupId,
    })
    const day2 = await createEvent({
      title: 'D級',
      eventDate: '2026-08-08',
      entryGroupId,
    })
    const [channel] = await testDb
      .insert(lineChannels)
      .values({
        channelId: `ch-${crypto.randomUUID()}`,
        channelSecret: 'secret',
        channelAccessToken: 'tok-bulk',
        botId: '@bulk-bot',
        purpose: 'event_broadcast',
        status: 'active',
        assignedEntryGroupId: entryGroupId,
      })
      .returning()
    await testDb.insert(eventLineBroadcasts).values({
      entryGroupId,
      lineChannelId: channel!.id,
      status: 'linked',
      lineGroupId: 'Gbulk',
      linkedAt: new Date(),
    })

    const claim1 = await claimLifecycleNotification(testDb, day1.id, 'entry_applied')
    const claim2 = await claimLifecycleNotification(testDb, day2.id, 'entry_applied')
    expect(claim1.claimed).toBe(true)
    expect(claim2.claimed).toBe(true)

    const result = await sendClaimedNotificationBulk(testDb, {
      notificationIds: [claim1.id!, claim2.id!],
      eventId: day1.id,
      message: '✅8/1(土)C級・8/8(土)D級の参加申込が完了しました。',
    })
    expect(result.outcome).toBe('sent')

    const rows = await testDb
      .select()
      .from(eventLifecycleNotifications)
      .where(eq(eventLifecycleNotifications.type, 'entry_applied'))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'sent' && r.lineGroupId === 'Gbulk')).toBe(true)
  })
})
