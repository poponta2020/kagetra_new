import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  events,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Import under test AFTER mocks so @/auth resolves to the mock.
const { setEntryApplied, setEntryNotApplying, setPaymentType, setPaymentPaid } =
  await import('./actions')

async function seedLinkedEvent(overrides: Parameters<typeof createEvent>[0] = {}) {
  const event = await createEvent({ title: 'Linked', ...overrides })
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: '@bot',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: event.entryGroupId,
    })
    .returning()
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId: event.entryGroupId,
    lineChannelId: channel!.id,
    status: 'linked',
    lineGroupId: 'Glifecycle',
    linkedAt: new Date(),
  })
  return event
}

async function getEvent(id: number) {
  return testDb.query.events.findFirst({ where: eq(events.id, id) })
}

async function notifications(eventId: number) {
  return testDb
    .select()
    .from(eventLifecycleNotifications)
    .where(eq(eventLifecycleNotifications.eventId, eventId))
}

describe('event lifecycle actions', () => {
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

  it('setEntryApplied(true): linked 大会で申込済 + 参加者向け/会計向けの 2 通とも sent', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)

    const row = await getEvent(event.id)
    expect(row?.entryStatus).toBe('applied')
    expect(row?.entryAppliedAt).not.toBeNull()

    const logs = await notifications(event.id)
    // entry-notify-lottery-treasurer: 申込完了で 2 種別とも once-ever claim + push。
    const byType = new Map(logs.map((l) => [l.type, l]))
    expect(byType.size).toBe(2)
    expect(byType.get('entry_applied')).toMatchObject({
      status: 'sent',
      lineGroupId: 'Glifecycle',
    })
    expect(byType.get('entry_applied_treasurer')).toMatchObject({
      status: 'sent',
      lineGroupId: 'Glifecycle',
    })
  })

  it('setEntryApplied: 再トグル（戻して再申込）でも 2 種別とも 1 回限り', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)
    await setEntryApplied(event.id, false)
    await setEntryApplied(event.id, true)

    expect((await getEvent(event.id))?.entryStatus).toBe('applied')
    // 通知ログは entry_applied + entry_applied_treasurer の 2 行のみ（種別ごとに once-ever）
    const logs = await notifications(event.id)
    expect(logs).toHaveLength(2)
    expect(new Set(logs.map((l) => l.type))).toEqual(
      new Set(['entry_applied', 'entry_applied_treasurer']),
    )
  })

  it('setEntryApplied(true): 未紐付けは申込済にするが 2 種別とも skipped を記録（スロット消費）', async () => {
    const admin = await createAdmin()
    const event = await createEvent({ title: 'Unlinked' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)

    expect((await getEvent(event.id))?.entryStatus).toBe('applied')
    const logs = await notifications(event.id)
    expect(logs).toHaveLength(2)
    // バックフィル防止: 後から linked になっても 2 通とも再送しない（既存方針と一貫）
    expect(logs.every((l) => l.status === 'skipped')).toBe(true)
    expect(new Set(logs.map((l) => l.type))).toEqual(
      new Set(['entry_applied', 'entry_applied_treasurer']),
    )
  })

  it('setEntryApplied(true): lottery_date / payment 情報を持つ大会でも 2 通とも sent（文面は lib テストで検証）', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent({
      title: '新春かるた大会',
      lotteryDate: '2026-01-20',
      paymentDeadline: '2026-01-25',
      paymentMethod: '北洋銀行',
      paymentInfo: '普通 1234567 北大かるた会',
    })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)

    const logs = await notifications(event.id)
    expect(logs).toHaveLength(2)
    expect(logs.every((l) => l.status === 'sent')).toBe(true)
    // 文面そのものは buildLifecycleMessage の純粋関数テストで網羅 (event-lifecycle-notify.test.ts)。
    // ここでは「会計向け 2 通目の slot 消費＋送信成功」だけ担保する。
  })

  it('setEntryApplied(false): 申込日時を null に戻し通知しない', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)
    await setEntryApplied(event.id, false)

    const row = await getEvent(event.id)
    expect(row?.entryStatus).toBe('not_applied')
    expect(row?.entryAppliedAt).toBeNull()
  })

  it('一般会員は申込状態を変更できない（Forbidden）', async () => {
    const member = await createUser({ role: 'member' })
    const event = await seedLinkedEvent()
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(setEntryApplied(event.id, true)).rejects.toThrow('Forbidden')
    expect((await getEvent(event.id))?.entryStatus).toBe('not_applied')
    expect(await notifications(event.id)).toHaveLength(0)
  })

  it('setPaymentType: 事前払い/現地払い/未設定を切り替える', async () => {
    const admin = await createAdmin()
    const event = await createEvent({ title: 'Pay' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setPaymentType(event.id, 'advance')
    expect((await getEvent(event.id))?.paymentType).toBe('advance')
    await setPaymentType(event.id, 'onsite')
    expect((await getEvent(event.id))?.paymentType).toBe('onsite')
    await setPaymentType(event.id, null)
    expect((await getEvent(event.id))?.paymentType).toBeNull()
  })

  it('setPaymentPaid(true): 事前払い + linked で支払済 + 完了通知', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent({ feeJpy: 2000 })
    await setAuthSession({ id: admin.id, role: 'admin' })
    await setPaymentType(event.id, 'advance')

    await setPaymentPaid(event.id, true)

    const row = await getEvent(event.id)
    expect(row?.paymentStatus).toBe('paid')
    expect(row?.paymentPaidAt).not.toBeNull()

    const logs = await notifications(event.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ type: 'payment_paid', status: 'sent' })
  })

  it('setPaymentPaid(true): payment_type が advance でないと行を更新せず通知もしない', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await setPaymentType(event.id, 'onsite')

    await setPaymentPaid(event.id, true)

    expect((await getEvent(event.id))?.paymentStatus).toBe('unpaid')
    expect(await notifications(event.id)).toHaveLength(0)
  })

  it('cancelled 大会は申込済にしても完了通知を送らない（状態は記録する）', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent({ status: 'cancelled' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)

    expect((await getEvent(event.id))?.entryStatus).toBe('applied')
    expect(await notifications(event.id)).toHaveLength(0)
  })

  it('cancelled 大会は支払済にしても完了通知を送らない', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent({ status: 'cancelled' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    await setPaymentType(event.id, 'advance')

    await setPaymentPaid(event.id, true)

    expect((await getEvent(event.id))?.paymentStatus).toBe('paid')
    expect(await notifications(event.id)).toHaveLength(0)
  })

  it('setPaymentType: advance 以外への変更で支払状態はリセットするが payment_paid の once-ever は保持（再支払いで再通知しない）', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const paidLogs = async () =>
      (await notifications(event.id)).filter((r) => r.type === 'payment_paid')

    await setPaymentType(event.id, 'advance')
    await setPaymentPaid(event.id, true)
    expect((await getEvent(event.id))?.paymentStatus).toBe('paid')
    expect(await paidLogs()).toHaveLength(1)
    const originalLogId = (await paidLogs())[0]!.id

    // onsite へ変更 → advance 専用の支払状態はリセット、ただし once-ever ログは保持
    await setPaymentType(event.id, 'onsite')
    const reset = await getEvent(event.id)
    expect(reset?.paymentType).toBe('onsite')
    expect(reset?.paymentStatus).toBe('unpaid')
    expect(reset?.paymentPaidAt).toBeNull()
    expect(await paidLogs()).toHaveLength(1) // ログは消さない（once-ever 永続）

    // 再び advance に戻して支払済 → 表示は paid に戻るが UNIQUE で再通知しない
    await setPaymentType(event.id, 'advance')
    await setPaymentPaid(event.id, true)
    expect((await getEvent(event.id))?.paymentStatus).toBe('paid')
    const logs = await paidLogs()
    expect(logs).toHaveLength(1) // 重複通知なし
    expect(logs[0]!.id).toBe(originalLogId) // 同一ログ行＝新規 INSERT されていない
  })

  // entry-overdue-alert タスク3: 「申し込まない」(entry_status='not_applying')。
  describe('setEntryNotApplying', () => {
    it('一般会員は呼べない（Forbidden）', async () => {
      const member = await createUser({ role: 'member' })
      const event = await seedLinkedEvent()
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(setEntryNotApplying(event.id)).rejects.toThrow('Forbidden')
      expect((await getEvent(event.id))?.entryStatus).toBe('not_applied')
    })

    it('admin は not_applied → not_applying に遷移できる', async () => {
      const admin = await createAdmin()
      const event = await seedLinkedEvent()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await setEntryNotApplying(event.id)

      const row = await getEvent(event.id)
      expect(row?.entryStatus).toBe('not_applying')
      expect(row?.entryAppliedAt).toBeNull()
    })

    it('vice_admin は applied → not_applying に遷移できる', async () => {
      const viceAdmin = await createUser({ role: 'vice_admin' })
      const event = await seedLinkedEvent()
      await setAuthSession({ id: viceAdmin.id, role: 'vice_admin' })

      await setEntryApplied(event.id, true)
      await setEntryNotApplying(event.id)

      const row = await getEvent(event.id)
      expect(row?.entryStatus).toBe('not_applying')
      expect(row?.entryAppliedAt).toBeNull()
    })

    it('設定時に LINE 通知は一切送られない（event_lifecycle_notifications に行が増えない）', async () => {
      const admin = await createAdmin()
      const event = await seedLinkedEvent()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await setEntryNotApplying(event.id)

      expect(await notifications(event.id)).toHaveLength(0)
    })

    it('解除時（not_applying → not_applied 経由での申込済化）も LINE 通知は一切送られない', async () => {
      const admin = await createAdmin()
      const event = await seedLinkedEvent()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await setEntryNotApplying(event.id)
      expect(await notifications(event.id)).toHaveLength(0)

      // 解除のみ（申込済化しない）でも通知なし
      await setEntryApplied(event.id, false)
      expect((await getEvent(event.id))?.entryStatus).toBe('not_applied')
      expect(await notifications(event.id)).toHaveLength(0)
    })

    it('not_applying →（解除）→ not_applied →（申込済化）→ applied で参加者向け/会計向け 2 通が従来どおり送信される（AC-15）', async () => {
      const admin = await createAdmin()
      const event = await seedLinkedEvent()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await setEntryNotApplying(event.id)
      await setEntryApplied(event.id, false)
      expect((await getEvent(event.id))?.entryStatus).toBe('not_applied')

      await setEntryApplied(event.id, true)

      const row = await getEvent(event.id)
      expect(row?.entryStatus).toBe('applied')
      const logs = await notifications(event.id)
      const byType = new Map(logs.map((l) => [l.type, l]))
      expect(byType.size).toBe(2)
      expect(byType.get('entry_applied')).toMatchObject({ status: 'sent' })
      expect(byType.get('entry_applied_treasurer')).toMatchObject({ status: 'sent' })
    })

    it('once-ever 回帰: 一度 applied になった大会を not_applying → not_applied → applied と戻しても再送されない（AC-18）', async () => {
      const admin = await createAdmin()
      const event = await seedLinkedEvent()
      await setAuthSession({ id: admin.id, role: 'admin' })

      // 一度 applied にして 2 通の once-ever スロットを消費させる。
      await setEntryApplied(event.id, true)
      const firstLogs = await notifications(event.id)
      expect(firstLogs).toHaveLength(2)
      const firstLogIds = new Set(firstLogs.map((l) => l.id))

      // 「申し込まない」→ 解除 → 再度申込済に戻す。
      await setEntryNotApplying(event.id)
      await setEntryApplied(event.id, false)
      await setEntryApplied(event.id, true)

      expect((await getEvent(event.id))?.entryStatus).toBe('applied')
      const secondLogs = await notifications(event.id)
      // 行数は増えない（新規 INSERT なし＝同一ログ行のまま）。
      expect(secondLogs).toHaveLength(2)
      expect(new Set(secondLogs.map((l) => l.id))).toEqual(firstLogIds)
    })
  })
})
