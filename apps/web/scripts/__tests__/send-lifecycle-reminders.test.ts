import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent } from '@/test-utils/seed'
import {
  collectReminderCandidates,
  sendLifecycleReminders,
} from '../send-lifecycle-reminders'

const TODAY = '2026-06-10'
const LEAD = 3
const ADVANCE = '2026-06-13' // TODAY + LEAD

type EventOverrides = Parameters<typeof createEvent>[0]

async function seedEvent(overrides: EventOverrides, opts: { linked?: boolean } = {}) {
  const event = await createEvent({ eventDate: '2026-07-01', ...overrides })
  if (opts.linked) {
    const unique = crypto.randomUUID()
    const [channel] = await testDb
      .insert(lineChannels)
      .values({
        channelId: `ch-${unique}`,
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
      lineGroupId: `G${unique.slice(0, 8)}`,
      linkedAt: new Date(),
    })
  }
  return event
}

async function candidateKeys() {
  const candidates = await collectReminderCandidates(testDb, {
    today: TODAY,
    advanceDate: ADVANCE,
    leadDays: LEAD,
  })
  return candidates.map((c) => `${c.eventId}:${c.type}`)
}

// File-scoped hooks: the test DB pool is a module singleton, so it must be
// closed exactly once (per-describe afterAll would end it before later blocks).
beforeEach(async () => {
  process.env.LINE_NOTIFY_DRY_RUN = '1'
  await truncateAll()
})
afterAll(async () => {
  delete process.env.LINE_NOTIFY_DRY_RUN
  await closeTestDb()
})

describe('send-lifecycle-reminders — candidate selection', () => {
  it('申込締切: today+lead は advance、today は day（未申込のみ）', async () => {
    const advance = await seedEvent(
      { title: 'A', entryDeadline: ADVANCE, entryStatus: 'not_applied' },
      { linked: true },
    )
    const day = await seedEvent(
      { title: 'B', entryDeadline: TODAY, entryStatus: 'not_applied' },
      { linked: true },
    )
    // 申込済はリマインドしない
    await seedEvent(
      { title: 'C', entryDeadline: TODAY, entryStatus: 'applied' },
      { linked: true },
    )
    // 締切が対象外日付
    await seedEvent(
      { title: 'D', entryDeadline: '2026-06-12', entryStatus: 'not_applied' },
      { linked: true },
    )

    const keys = await candidateKeys()
    expect(keys).toContain(`${advance.id}:entry_deadline_advance`)
    expect(keys).toContain(`${day.id}:entry_deadline_day`)
    expect(keys).toHaveLength(2)
  })

  it('事前支払締切: advance かつ未払のみ（paid / onsite / 未設定 は除外）', async () => {
    const advance = await seedEvent(
      {
        title: 'PA',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: ADVANCE,
      },
      { linked: true },
    )
    const day = await seedEvent(
      {
        title: 'PD',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: TODAY,
      },
      { linked: true },
    )
    // 支払済は除外
    await seedEvent(
      {
        title: 'PP',
        paymentType: 'advance',
        paymentStatus: 'paid',
        paymentDeadline: TODAY,
      },
      { linked: true },
    )
    // payment_type 未設定は支払い通知なし
    await seedEvent({ title: 'PN', paymentDeadline: TODAY }, { linked: true })

    const keys = await candidateKeys()
    expect(keys).toContain(`${advance.id}:payment_deadline_advance`)
    expect(keys).toContain(`${day.id}:payment_deadline_day`)
    expect(keys.filter((k) => k.includes('payment_deadline'))).toHaveLength(2)
  })

  it('現地払い: event_date 起点で advance / day（onsite のみ）', async () => {
    const advance = await seedEvent(
      { title: 'OA', paymentType: 'onsite', eventDate: ADVANCE },
      { linked: true },
    )
    const day = await seedEvent(
      { title: 'OD', paymentType: 'onsite', eventDate: TODAY },
      { linked: true },
    )
    // advance 払いは event_date 起点リマインドの対象外
    await seedEvent(
      { title: 'OX', paymentType: 'advance', eventDate: TODAY },
      { linked: true },
    )

    const keys = await candidateKeys()
    expect(keys).toContain(`${advance.id}:onsite_payment_advance`)
    expect(keys).toContain(`${day.id}:onsite_payment_day`)
    expect(keys.filter((k) => k.includes('onsite'))).toHaveLength(2)
  })

  it('未紐付け・cancelled は除外する', async () => {
    // 未紐付け（binding なし）
    await seedEvent(
      { title: 'Unlinked', entryDeadline: TODAY, entryStatus: 'not_applied' },
      { linked: false },
    )
    // cancelled
    await seedEvent(
      {
        title: 'Cancelled',
        status: 'cancelled',
        entryDeadline: TODAY,
        entryStatus: 'not_applied',
      },
      { linked: true },
    )

    expect(await candidateKeys()).toHaveLength(0)
  })
})

describe('send-lifecycle-reminders — sending', () => {
  it('対象を once-ever で送信し、再実行では UNIQUE で二重送信しない', async () => {
    await seedEvent(
      { title: 'A', entryDeadline: TODAY, entryStatus: 'not_applied' },
      { linked: true },
    )
    await seedEvent(
      { title: 'B', paymentType: 'onsite', eventDate: ADVANCE },
      { linked: true },
    )

    const first = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
    expect(first.sent).toBe(2)
    expect(first.skipped).toBe(0)

    const second = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(2)

    // ログは 2 行だけ（二重送信なし）、いずれも sent
    const rows = await testDb.select().from(eventLifecycleNotifications)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'sent')).toBe(true)
  })

  it('対象なしの日は何も送らない', async () => {
    await seedEvent(
      { title: 'Future', entryDeadline: '2026-09-01', entryStatus: 'not_applied' },
      { linked: true },
    )
    const result = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
    expect(result).toMatchObject({ sent: 0, skipped: 0, failed: 0 })
    const rows = await testDb
      .select()
      .from(eventLifecycleNotifications)
      .where(eq(eventLifecycleNotifications.type, 'entry_deadline_day'))
    expect(rows).toHaveLength(0)
  })
})
