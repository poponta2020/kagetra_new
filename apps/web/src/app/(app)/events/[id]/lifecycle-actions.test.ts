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
const { setEntryApplied, setPaymentType, setPaymentPaid } = await import('./actions')

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
      assignedEventId: event.id,
    })
    .returning()
  await testDb.insert(eventLineBroadcasts).values({
    eventId: event.id,
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

  it('setEntryApplied(true): linked 大会で申込済 + 完了通知を 1 回送る', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)

    const row = await getEvent(event.id)
    expect(row?.entryStatus).toBe('applied')
    expect(row?.entryAppliedAt).not.toBeNull()

    const logs = await notifications(event.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      type: 'entry_applied',
      status: 'sent',
      lineGroupId: 'Glifecycle',
    })
  })

  it('setEntryApplied: 再トグル（戻して再申込）でも再通知しない（once-ever）', async () => {
    const admin = await createAdmin()
    const event = await seedLinkedEvent()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)
    await setEntryApplied(event.id, false)
    await setEntryApplied(event.id, true)

    expect((await getEvent(event.id))?.entryStatus).toBe('applied')
    // 通知ログは初回 claim の 1 行のみ
    expect(await notifications(event.id)).toHaveLength(1)
  })

  it('setEntryApplied(true): 未紐付けは申込済にするが通知は飛ばさず skipped を記録', async () => {
    const admin = await createAdmin()
    const event = await createEvent({ title: 'Unlinked' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await setEntryApplied(event.id, true)

    expect((await getEvent(event.id))?.entryStatus).toBe('applied')
    const logs = await notifications(event.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ type: 'entry_applied', status: 'skipped' })
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
})
