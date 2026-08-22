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
  buildTreasurerNoticeMessage,
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

  // ---------------------------------------------------------------------
  // 2026-08-22 line-bot-message-revamp タスク5/6: 全9種別の文面を全面差し替えた
  // （大会名・金額を廃止、複数日ラベルを廃止、日付は formatEventDate へ）。
  // entry_applied_treasurer（タスク6・AC-29）はメンション付き予告文へ差し替え、
  // 正本の文面テストは下の `describe('buildTreasurerNoticeMessage')` に置く。
  // ---------------------------------------------------------------------

  it('申込完了: 抽選日ありは空行を挟んで「抽選日はM/D(曜)です。」を追記する（AC-26/27/30）', () => {
    expect(
      buildLifecycleMessage('entry_applied', { title, lotteryDateIso: '2026-01-20' }),
    ).toBe('申し込みが完了しました！\n\n抽選日は1/20(火)です。')
  })

  it('申込完了: lotteryDateIso 未指定は「抽選日は未定です。」（AC-27）', () => {
    expect(buildLifecycleMessage('entry_applied', { title })).toBe(
      '申し込みが完了しました！\n\n抽選日は未定です。',
    )
  })

  it('申込完了: lotteryDateIso が null/空文字でも「抽選日は未定です。」（AC-27）', () => {
    expect(buildLifecycleMessage('entry_applied', { title, lotteryDateIso: null })).toBe(
      '申し込みが完了しました！\n\n抽選日は未定です。',
    )
    expect(buildLifecycleMessage('entry_applied', { title, lotteryDateIso: '' })).toBe(
      '申し込みが完了しました！\n\n抽選日は未定です。',
    )
  })

  it('申込完了: title（大会名）を渡しても文面に一切出ない（AC-26）', () => {
    const msg = buildLifecycleMessage('entry_applied', {
      title: 'テスト大会',
      lotteryDateIso: '2026-01-20',
    })
    expect(msg).not.toContain('テスト大会')
    expect(msg).not.toContain('【')
  })

  it('会計向け（entry_applied_treasurer）: buildLifecycleMessage は素テキスト版（メンション0件相当）を返す。正本の文面テストは buildTreasurerNoticeMessage 側（AC-29）', () => {
    expect(buildLifecycleMessage('entry_applied_treasurer', { title })).toBe(
      '@会計\n振込連絡は名簿確定時に連絡します。',
    )
    // title を渡しても文面に一切出ない（大会名を出さない・AC-26）。
    expect(buildLifecycleMessage('entry_applied_treasurer', { title: 'テスト大会' })).not.toContain(
      'テスト大会',
    )
  })

  it('申込締切・事前: 日付（曜日つき）とリードタイムを差し込む（数字と「日」の間は空けない・AC-30）', () => {
    expect(
      buildLifecycleMessage('entry_deadline_advance', {
        title,
        dateIso: '2026-06-05',
        leadDays: 3,
      }),
    ).toBe('申込締切は6/5(金)（あと3日）です。まだ申し込みが行われていません。')
  })

  it('申込締切・当日: 固定文言（⚠️ は絵文字 U+26A0 U+FE0F・AC-30）', () => {
    const msg = buildLifecycleMessage('entry_deadline_day', { title, dateIso: '2026-06-05' })
    expect(msg).toBe('⚠️申込は今日までです！⚠️')
  })

  it('支払完了: 固定文言（金額を出さない・AC-26）', () => {
    expect(buildLifecycleMessage('payment_paid', { title })).toBe(
      '参加費の振り込みが完了しました。',
    )
  })

  it('支払締切・事前: 日付（曜日つき）とリードタイムを差し込む', () => {
    expect(
      buildLifecycleMessage('payment_deadline_advance', {
        title,
        dateIso: '2026-06-10',
        leadDays: 3,
      }),
    ).toBe('支払い締切は6/10(水)（あと3日）です。まだ振込が行われていません。')
  })

  it('支払締切・当日: 固定文言', () => {
    const msg = buildLifecycleMessage('payment_deadline_day', { title, dateIso: '2026-06-10' })
    expect(msg).toBe('⚠️振込締切は今日までです！⚠️')
  })

  it('現地払い・事前: 固定文言（金額を出さない・AC-26）', () => {
    expect(
      buildLifecycleMessage('onsite_payment_advance', {
        title,
        dateIso: '2026-06-20',
      }),
    ).toBe('参加費は現地払いです。当日忘れないようにしてください。')
  })

  it('現地払い・当日: 固定文言（金額を出さない・AC-26）', () => {
    expect(buildLifecycleMessage('onsite_payment_day', { title })).toBe(
      '大会当日です！参加費を忘れないようにしてください。',
    )
  })

  it('全 9 種別が非空メッセージを返す（branch 漏れ検出）。どの種別も title（大会名）を含まない（AC-26）', () => {
    expect(eventLifecycleNotificationTypeEnum.enumValues.length).toBe(9)
    for (const type of eventLifecycleNotificationTypeEnum.enumValues) {
      const msg = buildLifecycleMessage(type, { title, dateIso: '2026-06-05' })
      expect(msg.length).toBeGreaterThan(5)
      expect(msg).not.toContain('春の大会')
    }
  })

  it('leadDays 省略時は reminderLeadDays() 既定値を使う', () => {
    const msg = buildLifecycleMessage('entry_deadline_advance', {
      title,
      dateIso: '2026-06-05',
    })
    expect(msg).toContain('あと3日')
  })
})

// ---------------------------------------------------------------------------
// 2026-08-22 line-bot-message-revamp タスク6（Issue #525・AC-29）:
// entry_applied_treasurer の正本文面。`payment_deadline` / `payment_method` /
// `payment_info` を一切参照しない・複数日でも単一日と同一の固定文面（大会名を
// 出さない以上、束ねても出し分ける材料がない）ことをここで固定する。
// ---------------------------------------------------------------------------
describe('buildTreasurerNoticeMessage', () => {
  it('メンション対象がいれば textV2 で @会計 相当のメンションを本文の上に置く', () => {
    const msg = buildTreasurerNoticeMessage({ kind: 'users', userIds: ['Uaaa', 'Ubbb'] })
    expect(msg).toEqual({
      type: 'textV2',
      text: '{m0} {m1}\n振込連絡は名簿確定時に連絡します。',
      substitution: {
        m0: { type: 'mention', mentionee: { type: 'user', userId: 'Uaaa' } },
        m1: { type: 'mention', mentionee: { type: 'user', userId: 'Ubbb' } },
      },
    })
  })

  it('会計0人なら素テキストへ倒れ、文面は崩さない（AC-5）', () => {
    const msg = buildTreasurerNoticeMessage({ kind: 'users', userIds: [] })
    expect(msg).toEqual({
      type: 'text',
      text: '@会計\n振込連絡は名簿確定時に連絡します。',
    })
  })

  it('mention.kind==="all" でも textV2 になる', () => {
    const msg = buildTreasurerNoticeMessage({ kind: 'all' })
    expect(msg).toEqual({
      type: 'textV2',
      text: '{m0}\n振込連絡は名簿確定時に連絡します。',
      substitution: { m0: { type: 'mention', mentionee: { type: 'all' } } },
    })
  })

  it('引数はメンション対象だけで、payment_deadline/payment_method/payment_info を受け取る余地が無い（AC-29）', () => {
    // 本文はメンション対象に関わらず常に同一固定文言（大会名・金額・複数日の
    // 出し分けなし）。呼び出し側がどんな振込情報を持っていても、この関数の
    // シグネチャ上そもそも渡しようがない＝型で参照禁止を保証している。
    const withEmpty = buildTreasurerNoticeMessage({ kind: 'users', userIds: [] })
    const withUsers = buildTreasurerNoticeMessage({ kind: 'users', userIds: ['U1'] })
    expect(withEmpty.text).toContain('振込連絡は名簿確定時に連絡します。')
    expect(withUsers.text).toContain('振込連絡は名簿確定時に連絡します。')
    expect(withEmpty.text).not.toContain('振込期限')
    expect(withUsers.text).not.toContain('振込期限')
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
