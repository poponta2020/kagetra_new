import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent } from '@/test-utils/seed'
import {
  bucketReminderCandidates,
  collectReminderCandidates,
  sendLifecycleReminders,
  type ReminderCandidate,
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
        assignedEntryGroupId: event.entryGroupId,
      })
      .returning()
    await testDb.insert(eventLineBroadcasts).values({
      entryGroupId: event.entryGroupId,
      lineChannelId: channel!.id,
      status: 'linked',
      lineGroupId: `G${unique.slice(0, 8)}`,
      linkedAt: new Date(),
    })
  }
  return event
}

/**
 * entry-groups タスク5 (AC-12): 複数イベントを**同じグループ**にまとめる検証で使う。
 * `event_line_broadcasts.entry_group_id` は UNIQUE（1グループ=1紐付け）なので、
 * `seedEvent(..., { linked: true })` をグループ内の複数イベントに対して呼ぶと
 * 2 回目の INSERT が一意制約違反になる。グループの紐付けは 1 回だけ、この
 * ヘルパーで作る。
 */
async function seedGroupBinding(entryGroupId: number) {
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
      assignedEntryGroupId: entryGroupId,
    })
    .returning()
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId,
    lineChannelId: channel!.id,
    status: 'linked',
    lineGroupId: `G${unique.slice(0, 8)}`,
    linkedAt: new Date(),
  })
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

  it('not_applying は申込締切リマインドの対象外（entry-overdue-alert AC-16）', async () => {
    // 3 値目 not_applying を足したことで、eq(entryStatus, 'not_applied') の
    // 条件式を一切変えずに見送った大会が自動で外れる、という設計への回帰。
    // この条件を「applied 以外」に緩めるとここが落ちる。
    await seedEvent(
      { title: 'NotApplying advance', entryDeadline: ADVANCE, entryStatus: 'not_applying' },
      { linked: true },
    )
    await seedEvent(
      { title: 'NotApplying day', entryDeadline: TODAY, entryStatus: 'not_applying' },
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

  // entry-groups タスク5 (AC-12): 締切リマインドは (グループ, 種別, 締切日) 単位の
  // 1通に集約され、対象日が列挙される。締切が異なる日は別通になる。
  //
  // push 回数は「LINE_NOTIFY_DRY_RUN=1; skipping lifecycle push」ログの出現回数で
  // 数える（dry-run では実際の fetch を呼ばないため、push 試行の回数はこのログでしか
  // 観測できない。1回のログ = 1回の pushSingleText 呼び出し = 集約された1通）。
  function countPushes(logger: { info: ReturnType<typeof vi.fn> }) {
    return logger.info.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('skipping lifecycle push'),
    ).length
  }

  it('AC-12: 同一グループ・同一締切日の複数大会は1通に集約される（push は1回だけ）', async () => {
    const group = await createEntryGroup()
    await createEvent({
      title: 'グループA',
      eventDate: '2026-08-15',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await createEvent({
      title: 'グループB',
      eventDate: '2026-08-11',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await seedGroupBinding(group.id)

    const logger = { info: vi.fn(), warn: vi.fn() }
    const result = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD, logger })

    expect(result.sent).toBe(2) // (event,type) 単位の once-ever カウントは従来どおり2件分
    expect(countPushes(logger)).toBe(1) // だが実際に push されたのは1回（集約1通）
  })

  it('AC-12: 締切が異なる日は別通になる（push は日ごとに別）', async () => {
    const group = await createEntryGroup()
    await createEvent({
      title: 'グループA',
      eventDate: '2026-08-15',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await createEvent({
      title: 'グループB',
      eventDate: '2026-08-11',
      entryDeadline: ADVANCE,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await seedGroupBinding(group.id)

    const logger = { info: vi.fn(), warn: vi.fn() }
    const result = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD, logger })

    expect(result.sent).toBe(2)
    expect(countPushes(logger)).toBe(2) // day 用と advance 用で別バケット→別通
  })

  it('AC-12: cron 再実行では claim できた残り分だけが新たな1通になる', async () => {
    const group = await createEntryGroup()
    await createEvent({
      title: 'グループA',
      eventDate: '2026-08-15',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await seedGroupBinding(group.id)

    const first = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
    expect(first.sent).toBe(1)

    // 後から同じグループへ別の日が申込締切超過の対象として加わった状況を模す。
    await createEvent({
      title: 'グループB',
      eventDate: '2026-08-11',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })

    const logger = { info: vi.fn(), warn: vi.fn() }
    const second = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD, logger })
    // 既送のグループAは skipped のまま、新規のグループBだけが1通で sent。
    expect(second.sent).toBe(1)
    expect(second.skipped).toBe(1)
    expect(countPushes(logger)).toBe(1)

    const rows = await testDb.select().from(eventLifecycleNotifications)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'sent')).toBe(true)
  })

  it('AC-12: 二重 claim なし（同じバケットを2回実行しても行数は増えない）', async () => {
    const group = await createEntryGroup()
    await createEvent({
      title: 'グループA',
      eventDate: '2026-08-15',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await createEvent({
      title: 'グループB',
      eventDate: '2026-08-11',
      entryDeadline: TODAY,
      entryStatus: 'not_applied',
      entryGroupId: group.id,
    })
    await seedGroupBinding(group.id)

    await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
    await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })

    const rows = await testDb.select().from(eventLifecycleNotifications)
    expect(rows).toHaveLength(2)
  })
})

describe('bucketReminderCandidates (pure)', () => {
  function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
    return {
      eventId: 1,
      entryGroupId: 1,
      type: 'entry_deadline_advance',
      title: 'テスト大会',
      eventDate: '2030-01-01',
      feeJpy: null,
      dateIso: '2026-06-13',
      message: 'message',
      ...overrides,
    }
  }

  it('同一 (グループ, 種別, 締切日) の候補は1バケットにまとまる', () => {
    const buckets = bucketReminderCandidates([candidate({ eventId: 1 }), candidate({ eventId: 2 })])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.members.map((m) => m.eventId)).toEqual([1, 2])
  })

  it('AC-12: 締切日（dateIso）が異なれば別バケットになる', () => {
    const buckets = bucketReminderCandidates([
      candidate({ eventId: 1, dateIso: '2026-06-13' }),
      candidate({ eventId: 2, dateIso: '2026-06-20' }),
    ])
    expect(buckets).toHaveLength(2)
  })

  it('グループが異なれば別バケットになる', () => {
    const buckets = bucketReminderCandidates([
      candidate({ eventId: 1, entryGroupId: 1 }),
      candidate({ eventId: 2, entryGroupId: 2 }),
    ])
    expect(buckets).toHaveLength(2)
  })

  it('通知種別が異なれば別バケットになる', () => {
    const buckets = bucketReminderCandidates([
      candidate({ eventId: 1, type: 'entry_deadline_advance' }),
      candidate({ eventId: 2, type: 'entry_deadline_day' }),
    ])
    expect(buckets).toHaveLength(2)
  })
})
