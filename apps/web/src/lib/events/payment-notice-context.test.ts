import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroups,
  entryGroupPaymentNotices,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { loadPaymentNoticeContext } from './payment-notice-context'

/**
 * 振込連絡の露出条件（line-bot-message-revamp §3.3.1）と初期値。
 * 露出条件は申込管理ボードの `payment_due` 区画と同じ（settled ∧ 事前払い ∧ 未振込）。
 */

/** 手動トグルで「確定名簿あり」にする（4材料のうち④）。 */
async function markRosterOverride(groupId: number) {
  await testDb
    .update(entryGroups)
    .set({ confirmedRosterOverride: true })
    .where(eq(entryGroups.id, groupId))
}

/** LINE 紐付け済みの binding を1本立てる。 */
async function linkLineGroup(entryGroupId: number) {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      botId: `@bot-${entryGroupId}`,
      channelId: `cid-${entryGroupId}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: entryGroupId,
    })
    .returning()
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId,
    lineChannelId: channel!.id,
    lineGroupId: `G-${entryGroupId}`,
    status: 'linked',
  })
}

/** 名簿確定・事前払い・未振込・申込済のグループを1日分作る。 */
async function seedDueGroup(overrides: Record<string, unknown> = {}) {
  const group = await createEntryGroup()
  await markRosterOverride(group.id)
  const event = await createEvent({
    entryGroupId: group.id,
    official: true,
    kind: 'individual',
    entryStatus: 'applied',
    paymentType: 'advance',
    paymentStatus: 'unpaid',
    paymentDeadline: '2026-07-25',
    paymentDeadlineKind: 'fixed',
    paymentInfo: '〇〇銀行 普通 1234567',
    ...overrides,
  })
  return { group, event }
}

describe('loadPaymentNoticeContext', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('名簿確定 ∧ 事前払い ∧ 未振込 のグループで文脈が返る（AC-9）', async () => {
    const { group } = await seedDueGroup()
    const ctx = await loadPaymentNoticeContext(group.id)
    expect(ctx).not.toBeNull()
    expect(ctx!.paymentDeadline).toBe('2026-07-25')
    expect(ctx!.paymentInfo).toBe('〇〇銀行 普通 1234567')
  })

  it('手動トグル（confirmed_roster_override）で進めたグループでも出る（AC-10）', async () => {
    // seedDueGroup は override だけで settled にしているので、これがそのまま AC-10。
    const { group } = await seedDueGroup()
    expect(await loadPaymentNoticeContext(group.id)).not.toBeNull()
  })

  it('確定名簿が無ければ出ない', async () => {
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
    })
    expect(await loadPaymentNoticeContext(group.id)).toBeNull()
  })

  it('現地払いのグループでは出ない（AC-11）', async () => {
    const { group } = await seedDueGroup({
      paymentType: 'onsite',
      paymentDeadline: null,
      paymentDeadlineKind: 'unspecified',
    })
    expect(await loadPaymentNoticeContext(group.id)).toBeNull()
  })

  it('支払済のグループでは出ない（AC-11）', async () => {
    const { group } = await seedDueGroup({ paymentStatus: 'paid' })
    expect(await loadPaymentNoticeContext(group.id)).toBeNull()
  })

  it('未申込のグループでは出ない', async () => {
    const { group } = await seedDueGroup({ entryStatus: 'not_applied' })
    expect(await loadPaymentNoticeContext(group.id)).toBeNull()
  })

  it('人数の初期値が参加費集計と一致する（ゲスト除外・AC-12）', async () => {
    const { group, event } = await seedDueGroup({ eligibleGrades: null })
    const a1 = await createUser({ name: 'pn-a1', grade: 'A' })
    const a2 = await createUser({ name: 'pn-a2', grade: 'A' })
    const b1 = await createUser({ name: 'pn-b1', grade: 'B' })
    const guest = await createUser({ name: 'pn-guest', grade: 'A', role: 'guest' })
    for (const u of [a1, a2, b1, guest]) {
      await createEventAttendance({ eventId: event.id, userId: u.id })
    }

    const ctx = await loadPaymentNoticeContext(group.id)
    // ゲストは参加費集計の母集団から外れる（A級は2名）。
    // 単価が解決できる対象級は人数0でも行を出す（管理者が確定名簿に合わせて直せるように）。
    expect(ctx!.rows).toEqual([
      { grade: 'A', count: 2, unitJpy: 2500 },
      { grade: 'B', count: 1, unitJpy: 2500 },
      { grade: 'C', count: 0, unitJpy: 2000 },
      { grade: 'D', count: 0, unitJpy: 2000 },
      { grade: 'E', count: 0, unitJpy: 1500 },
    ])
    expect(ctx!.hasSavedCounts).toBe(false)
  })

  it('出欠0人の級にも入力欄になる行を出す（確定名簿で増やせるようにする）', async () => {
    const { group, event } = await seedDueGroup({ eligibleGrades: ['A', 'B'] })
    const a1 = await createUser({ name: 'pn-z1', grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: a1.id })

    const ctx = await loadPaymentNoticeContext(group.id)
    expect(ctx!.rows).toEqual([
      { grade: 'A', count: 1, unitJpy: 2500 },
      { grade: 'B', count: 0, unitJpy: 2500 },
    ])
  })

  it('複数日は延べ人数で数える（同じ会員が2日出れば2名分）', async () => {
    const group = await createEntryGroup()
    await markRosterOverride(group.id)
    const common = {
      entryGroupId: group.id,
      entryStatus: 'applied' as const,
      paymentType: 'advance' as const,
      paymentStatus: 'unpaid' as const,
    }
    const day1 = await createEvent({ ...common, eventDate: '2026-08-01' })
    const day2 = await createEvent({ ...common, eventDate: '2026-08-08' })
    const user = await createUser({ name: 'pn-both', grade: 'A' })
    await createEventAttendance({ eventId: day1.id, userId: user.id })
    await createEventAttendance({ eventId: day2.id, userId: user.id })

    const ctx = await loadPaymentNoticeContext(group.id)
    expect(ctx!.rows.find((r) => r.grade === 'A')).toEqual({
      grade: 'A',
      count: 2,
      unitJpy: 2500,
    })
  })

  it('支払済みの日は金額の母集団から外れる（二重請求の防止）', async () => {
    const group = await createEntryGroup()
    await markRosterOverride(group.id)
    const common = {
      entryGroupId: group.id,
      eligibleGrades: null,
      entryStatus: 'applied' as const,
      paymentType: 'advance' as const,
    }
    const unpaid = await createEvent({
      ...common,
      eventDate: '2026-08-01',
      paymentStatus: 'unpaid',
    })
    const paid = await createEvent({ ...common, eventDate: '2026-08-08', paymentStatus: 'paid' })
    const user = await createUser({ name: 'pn-paid', grade: 'A' })
    await createEventAttendance({ eventId: unpaid.id, userId: user.id })
    await createEventAttendance({ eventId: paid.id, userId: user.id })

    const ctx = await loadPaymentNoticeContext(group.id)
    // 未振込の1日分だけ（支払済みの日を足すと2名分＝二重請求になる）。
    expect(ctx!.rows.find((r) => r.grade === 'A')).toEqual({
      grade: 'A',
      count: 1,
      unitJpy: 2500,
    })
  })

  it('支払情報・振込期限は未振込の日から決定的に選ぶ', async () => {
    const group = await createEntryGroup()
    await markRosterOverride(group.id)
    const common = {
      entryGroupId: group.id,
      entryStatus: 'applied' as const,
      paymentType: 'advance' as const,
    }
    // 支払済みの早い日（対象外）と、未振込の遅い日（対象）。
    await createEvent({
      ...common,
      eventDate: '2026-08-01',
      paymentStatus: 'paid',
      paymentDeadline: '2026-07-10',
      paymentDeadlineKind: 'fixed',
      paymentInfo: '旧口座 0000000',
    })
    await createEvent({
      ...common,
      eventDate: '2026-08-08',
      paymentStatus: 'unpaid',
      paymentDeadline: '2026-07-25',
      paymentDeadlineKind: 'fixed',
      paymentInfo: '新口座 1234567',
    })

    const ctx = await loadPaymentNoticeContext(group.id)
    expect(ctx!.paymentDeadline).toBe('2026-07-25')
    expect(ctx!.paymentInfo).toBe('新口座 1234567')
  })

  it('保存済みの人数があればそれを初期値にする（AC-14）', async () => {
    const { group, event } = await seedDueGroup({ eligibleGrades: null })
    const a1 = await createUser({ name: 'pn-s1', grade: 'A' })
    const a2 = await createUser({ name: 'pn-s2', grade: 'A' })
    for (const u of [a1, a2]) {
      await createEventAttendance({ eventId: event.id, userId: u.id })
    }
    await testDb.insert(entryGroupPaymentNotices).values({
      entryGroupId: group.id,
      gradeCounts: { A: 1 },
      totalJpy: 2500,
      lastSentAt: new Date('2026-07-20T00:00:00Z'),
    })

    const ctx = await loadPaymentNoticeContext(group.id)
    // 集計は2名だが、管理者が直した1名が再現される。
    expect(ctx!.rows.find((r) => r.grade === 'A')).toEqual({
      grade: 'A',
      count: 1,
      unitJpy: 2500,
    })
    // 保存に無い級は0名（行自体は残す）。
    expect(ctx!.rows.find((r) => r.grade === 'B')?.count).toBe(0)
    expect(ctx!.hasSavedCounts).toBe(true)
    expect(ctx!.lastSentAt).toEqual(new Date('2026-07-20T00:00:00Z'))
  })

  it('LINE 紐付けの有無を返す（紐付けが無ければボタンを出さない）', async () => {
    const { group } = await seedDueGroup()
    expect((await loadPaymentNoticeContext(group.id))!.hasLineBinding).toBe(false)
    await linkLineGroup(group.id)
    expect((await loadPaymentNoticeContext(group.id))!.hasLineBinding).toBe(true)
  })

  it('中止した日は母集団から外れる', async () => {
    const group = await createEntryGroup()
    await markRosterOverride(group.id)
    const common = {
      entryGroupId: group.id,
      entryStatus: 'applied' as const,
      paymentType: 'advance' as const,
      paymentStatus: 'unpaid' as const,
    }
    const live = await createEvent({ ...common, eventDate: '2026-08-01' })
    const dead = await createEvent({ ...common, eventDate: '2026-08-08', status: 'cancelled' })
    const user = await createUser({ name: 'pn-cancel', grade: 'A' })
    await createEventAttendance({ eventId: live.id, userId: user.id })
    await createEventAttendance({ eventId: dead.id, userId: user.id })

    const ctx = await loadPaymentNoticeContext(group.id)
    expect(ctx!.rows.find((r) => r.grade === 'A')).toEqual({
      grade: 'A',
      count: 1,
      unitJpy: 2500,
    })
  })
})
