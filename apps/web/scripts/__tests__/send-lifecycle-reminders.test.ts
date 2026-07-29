import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createEventAttendance, createUser } from '@/test-utils/seed'
import { formatEventDate } from '@/lib/event-date'
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
    // payment_type 未設定は支払い通知なし。grade-entry-fee で列の既定値が 'advance' に
    // なったため、「未設定」を作るには明示的に null を入れる必要がある（省略すると
    // advance で入り、正しく通知対象になる）。
    await seedEvent({ title: 'PN', paymentType: null, paymentDeadline: TODAY }, { linked: true })

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

  // r1 review blocker: 1イベントが同日に複数種別の候補になる（申込締切日＝現地払い当日）
  // ケース。以前は文面を eventId だけのキーの Map から引き直していたため、後の候補が
  // 前の候補を上書きし、entry_deadline_day のバケットに現地払いの文面が乗っていた。
  // 文面はバケットメンバー自身が持つ設計にしたので、種別と文面は必ず一致する。
  it('r1: 同一イベントが同日に2種別の対象になっても、それぞれ正しい文面で1通ずつ送られる', async () => {
    const sentTexts: string[] = []
    delete process.env.LINE_NOTIFY_DRY_RUN // 実 fetch 経路を通して本文を観測する
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body) as { messages: { text: string }[] }
        sentTexts.push(parsed.messages[0]!.text)
        return { ok: true, status: 200, text: async () => '' }
      }),
    )
    try {
      const event = await seedEvent(
        {
          title: '同日2種別大会',
          eventDate: TODAY, // → onsite_payment_day
          entryDeadline: TODAY, // → entry_deadline_day
          entryStatus: 'not_applied',
          paymentType: 'onsite',
          feeJpy: 3000,
        },
        { linked: true },
      )

      const result = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
      expect(result.sent).toBe(2)

      const rows = await testDb
        .select()
        .from(eventLifecycleNotifications)
        .where(eq(eventLifecycleNotifications.eventId, event.id))
      expect(rows.map((r) => r.type).sort()).toEqual(['entry_deadline_day', 'onsite_payment_day'])

      // 2通それぞれが自分の種別の文面であること（取り違えなし）。
      expect(sentTexts).toHaveLength(2)
      expect(sentTexts.filter((t) => t.includes('申込締切は本日'))).toHaveLength(1)
      expect(sentTexts.filter((t) => t.includes('現地払い'))).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
      process.env.LINE_NOTIFY_DRY_RUN = '1'
    }
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

describe('grade-entry-fee タスク5 — payment_deadline 総額 / onsite 導出単価', () => {
  /**
   * fetch を stub して実送信テキストを観測する（r1 テストと同じパターン。
   * dry-run では push を呼ばないため、複数日バケットの実文面はこの経路でしか見えない）。
   */
  async function withSentTexts(run: () => Promise<void>): Promise<string[]> {
    const sentTexts: string[] = []
    delete process.env.LINE_NOTIFY_DRY_RUN
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body) as { messages: { text: string }[] }
        sentTexts.push(parsed.messages[0]!.text)
        return { ok: true, status: 200, text: async () => '' }
      }),
    )
    try {
      await run()
    } finally {
      vi.unstubAllGlobals()
      process.env.LINE_NOTIFY_DRY_RUN = '1'
    }
    return sentTexts
  }

  it('AC-13: 単一日 payment_deadline_advance に振込総額行が付く', async () => {
    const event = await seedEvent(
      {
        title: 'PayFee',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: ADVANCE,
      },
      { linked: true },
    )
    const user = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: user.id, attend: true })

    const candidates = await collectReminderCandidates(testDb, {
      today: TODAY,
      advanceDate: ADVANCE,
      leadDays: LEAD,
    })
    const candidate = candidates.find((c) => c.type === 'payment_deadline_advance')!
    expect(candidate.message).toBe(
      '⏰【PayFee】の参加費の支払締切は 6/13（あと 3 日）です。まだ支払いが完了していません。\n' +
        '振込総額 2,500円（A級 1名×2,500）',
    )
  })

  it('AC-12: 複数日バケットは対象日だけの日別ラベル・総額はグループ全日の合算になる', async () => {
    const group = await createEntryGroup()
    const eventA = await createEvent({
      title: 'グループA',
      eventDate: '2026-08-15',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      paymentDeadline: TODAY,
      entryGroupId: group.id,
    })
    const eventB = await createEvent({
      title: 'グループB',
      eventDate: '2026-08-11',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      paymentDeadline: TODAY,
      entryGroupId: group.id,
    })
    await seedGroupBinding(group.id)

    const userA = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: eventA.id, userId: userA.id, attend: true })
    const userB = await createUser({ grade: 'C' })
    await createEventAttendance({ eventId: eventB.id, userId: userB.id, attend: true })

    const sentTexts = await withSentTexts(async () => {
      const result = await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
      expect(result.sent).toBe(2)
    })

    expect(sentTexts).toHaveLength(1)
    const text = sentTexts[0]!
    const daysLabel = `${formatEventDate('2026-08-11')}グループB・${formatEventDate('2026-08-15')}グループA`
    // 1行目の日別ラベルは対象日（TODAY 締切の2件）だけ。
    expect(text).toContain(
      `⚠️${daysLabel}の参加費の支払締切は本日 6/10 です。まだ支払いが完了していません。`,
    )
    // 総額はグループ全日の合算（A級2,500 + C級2,000 = 4,500）。
    expect(text).toContain('振込総額 4,500円（A級 1名×2,500 / C級 1名×2,000）')
  })

  it('AC-12: バケットに入っていない同グループの日の参加者も総額に含まれる', async () => {
    const group = await createEntryGroup()
    const eventA = await createEvent({
      title: 'グループA',
      eventDate: '2026-08-15',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      paymentDeadline: TODAY,
      entryGroupId: group.id,
    })
    const eventB = await createEvent({
      title: 'グループB',
      eventDate: '2026-08-11',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      paymentDeadline: TODAY,
      entryGroupId: group.id,
    })
    // 3日目: 締切日が異なるので TODAY のバケットには入らない。
    const eventC = await createEvent({
      title: 'グループC',
      eventDate: '2026-08-20',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      paymentDeadline: ADVANCE,
      entryGroupId: group.id,
    })
    await seedGroupBinding(group.id)

    const userA = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: eventA.id, userId: userA.id, attend: true })
    const userB = await createUser({ grade: 'C' })
    await createEventAttendance({ eventId: eventB.id, userId: userB.id, attend: true })
    const userC = await createUser({ grade: 'E' })
    await createEventAttendance({ eventId: eventC.id, userId: userC.id, attend: true })

    const candidates = await collectReminderCandidates(testDb, {
      today: TODAY,
      advanceDate: ADVANCE,
      leadDays: LEAD,
    })
    const dayCandidateA = candidates.find(
      (c) => c.eventId === eventA.id && c.type === 'payment_deadline_day',
    )!
    const dayCandidateB = candidates.find(
      (c) => c.eventId === eventB.id && c.type === 'payment_deadline_day',
    )!
    const advanceCandidateC = candidates.find(
      (c) => c.eventId === eventC.id && c.type === 'payment_deadline_advance',
    )!
    // TODAY バケットのメンバー（A,B）だけの合計は 4,500 円だが、総額はグループ3日分
    // （A:2,500 + C:2,000 + E:1,500 = 6,000）でなければならない（AC-12 の肝）。
    expect(dayCandidateA.totalJpy).toBe(6000)
    expect(dayCandidateB.totalJpy).toBe(6000)
    expect(advanceCandidateC.totalJpy).toBe(6000)
  })

  it('AC-14: 参加者0名/団体戦/非公認では総額行が出ず、文面が現行と一致する', async () => {
    const noAttendee = await seedEvent(
      {
        title: 'NoAttendee',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: TODAY,
      },
      { linked: true },
    )
    const team = await seedEvent(
      {
        title: 'TeamEvent',
        kind: 'team',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: TODAY,
      },
      { linked: true },
    )
    const teamUser = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: team.id, userId: teamUser.id, attend: true })

    const unofficial = await seedEvent(
      {
        title: 'Unofficial',
        official: false,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: TODAY,
      },
      { linked: true },
    )
    const unofficialUser = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: unofficial.id, userId: unofficialUser.id, attend: true })

    const candidates = await collectReminderCandidates(testDb, {
      today: TODAY,
      advanceDate: ADVANCE,
      leadDays: LEAD,
    })
    for (const [event, title] of [
      [noAttendee, 'NoAttendee'],
      [team, 'TeamEvent'],
      [unofficial, 'Unofficial'],
    ] as const) {
      const c = candidates.find((c) => c.eventId === event.id && c.type === 'payment_deadline_day')!
      expect(c.message).toBe(
        `⚠️【${title}】の参加費の支払締切は本日 6/10 です。まだ支払いが完了していません。`,
      )
    }
  })

  it('AC-15: onsite_payment_advance は eligible_grades={E} で導出単価 1,500円（fee_jpy は無視される）', async () => {
    const event = await seedEvent(
      {
        title: 'OnsiteE',
        paymentType: 'onsite',
        eventDate: ADVANCE,
        eligibleGrades: ['E'],
        // fee_jpy に別の値を入れておき、無視されることを固定する。
        feeJpy: 9999,
      },
      { linked: true },
    )
    const candidates = await collectReminderCandidates(testDb, {
      today: TODAY,
      advanceDate: ADVANCE,
      leadDays: LEAD,
    })
    const c = candidates.find((c) => c.eventId === event.id)!
    expect(c.message).toBe('💰【OnsiteE】は当日現地払いです。参加費 1,500円 を 6/13 当日お持ちください。')
  })

  it('AC-16: onsite_payment_advance は多級で級別単価表記になる', async () => {
    const event = await seedEvent(
      {
        title: 'OnsiteABC',
        paymentType: 'onsite',
        eventDate: ADVANCE,
        eligibleGrades: ['A', 'B', 'C'],
      },
      { linked: true },
    )
    const candidates = await collectReminderCandidates(testDb, {
      today: TODAY,
      advanceDate: ADVANCE,
      leadDays: LEAD,
    })
    const c = candidates.find((c) => c.eventId === event.id)!
    expect(c.message).toBe(
      '💰【OnsiteABC】は当日現地払いです。参加費 A・B級 2,500円 / C級 2,000円 を 6/13 当日お持ちください。',
    )
  })

  it('回帰: entry_deadline_* のバケット文面は変更なし', async () => {
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

    const sentTexts = await withSentTexts(async () => {
      await sendLifecycleReminders(testDb, { today: TODAY, leadDays: LEAD })
    })

    expect(sentTexts).toHaveLength(1)
    const daysLabel = `${formatEventDate('2026-08-11')}グループB・${formatEventDate('2026-08-15')}グループA`
    expect(sentTexts[0]).toBe(`⚠️${daysLabel}の申込締切は本日 6/10 です。まだ申込が完了していません。`)
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
