import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroups,
  entryGroupPaymentNotices,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())

const { loadPaymentNoticeDraft } = await import('./payment-notice-actions')

/**
 * メール処理画面の振込連絡ドラフト（line-bot-message-revamp §3.3.5）。
 *
 * ★この画面は **`settled` を露出条件に入れない**（§3.3.5.1 / §7-6）。処理の実行
 * そのものが確定名簿シグナルを成立させるので、処理前に見ると必ず false になる。
 */

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

/** 確定名簿が**まだ無い**申込済・事前払い・未振込のグループ（メール処理の直前の姿）。 */
async function seedPreSettledGroup(overrides: Record<string, unknown> = {}) {
  const group = await createEntryGroup()
  await linkLineGroup(group.id)
  const event = await createEvent({
    entryGroupId: group.id,
    official: true,
    kind: 'individual',
    eligibleGrades: null,
    entryStatus: 'applied',
    paymentType: 'advance',
    paymentStatus: 'unpaid',
    paymentDeadline: null,
    paymentDeadlineKind: 'unspecified',
    paymentInfo: null,
    ...overrides,
  })
  return { group, event }
}

describe('loadPaymentNoticeDraft', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  async function asAdmin(name: string) {
    const admin = await createAdmin({ name })
    await setAuthSession({ id: admin.id, role: 'admin' })
    return admin
  }

  it('確定名簿がまだ無くても送信可として返る（AC-31 / AC-33）', async () => {
    await asAdmin('pnd-admin-1')
    const { group } = await seedPreSettledGroup()
    // 手動トグルも名簿採用もしていない＝ settled は false。
    const settledRow = await testDb.query.entryGroups.findFirst({
      where: eq(entryGroups.id, group.id),
    })
    expect(settledRow?.confirmedRosterOverride).toBe(false)

    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.canSend).toBe(true)
    expect(draft.unavailableReason).toBeNull()
  })

  it('人数0の級も行として返し、単価を添える（AC-13 / AC-37）', async () => {
    await asAdmin('pnd-admin-2')
    const { group, event } = await seedPreSettledGroup()
    const a1 = await createUser({ name: 'pnd-a1', grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: a1.id })

    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.rows).toEqual([
      { grade: 'A', count: 1, unitJpy: 2500 },
      { grade: 'B', count: 0, unitJpy: 2500 },
      { grade: 'C', count: 0, unitJpy: 2000 },
      { grade: 'D', count: 0, unitJpy: 2000 },
      { grade: 'E', count: 0, unitJpy: 1500 },
    ])
    expect(draft.hasSavedCounts).toBe(false)
  })

  it('人数の初期値が未振込の日だけの集計になる（AC-36）', async () => {
    await asAdmin('pnd-admin-3')
    const group = await createEntryGroup()
    await linkLineGroup(group.id)
    const common = {
      entryGroupId: group.id,
      official: true,
      kind: 'individual' as const,
      eligibleGrades: null,
      entryStatus: 'applied' as const,
      paymentType: 'advance' as const,
    }
    const unpaid = await createEvent({ ...common, eventDate: '2026-08-01', paymentStatus: 'unpaid' })
    const paid = await createEvent({ ...common, eventDate: '2026-08-08', paymentStatus: 'paid' })
    const user = await createUser({ name: 'pnd-both', grade: 'A' })
    await createEventAttendance({ eventId: unpaid.id, userId: user.id })
    await createEventAttendance({ eventId: paid.id, userId: user.id })

    const draft = await loadPaymentNoticeDraft(group.id)
    // 支払済みの日を足すと2名分＝二重請求。
    expect(draft.rows.find((r) => r.grade === 'A')?.count).toBe(1)
  })

  it('共通項目（支払締切・振込先）の初期値を返す（§3.3.5.3）', async () => {
    await asAdmin('pnd-admin-4')
    const { group } = await seedPreSettledGroup({
      paymentDeadline: '2026-07-25',
      paymentDeadlineKind: 'fixed',
      paymentInfo: '〇〇銀行 普通 1234567',
    })
    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.paymentDeadline).toBe('2026-07-25')
    expect(draft.paymentDeadlineKind).toBe('fixed')
    expect(draft.paymentInfo).toBe('〇〇銀行 普通 1234567')
  })

  it('杉並AB 型（振込期限が空）でも送信可で、締切だけ空のまま返る（AC-39）', async () => {
    await asAdmin('pnd-admin-5')
    const { group } = await seedPreSettledGroup()
    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.canSend).toBe(true)
    expect(draft.paymentDeadline).toBeNull()
    expect(draft.paymentDeadlineKind).toBe('unspecified')
  })

  it('未申込のときは送信不可で理由が返る（AC-34）', async () => {
    await asAdmin('pnd-admin-6')
    const { group } = await seedPreSettledGroup({ entryStatus: 'not_applied' })
    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.canSend).toBe(false)
    expect(draft.unavailableReason).toBe('not_applied')
    expect(draft.unavailableMessage).toBe('まだ申込済みになっていません')
  })

  it('送信不可でも共通項目の初期値は返す（§3.3.5.3: 保存は送信可否と切り離す）', async () => {
    await asAdmin('pnd-admin-6b')
    const { group } = await seedPreSettledGroup({
      entryStatus: 'not_applied',
      paymentDeadline: '2026-07-25',
      paymentDeadlineKind: 'fixed',
      paymentInfo: '〇〇銀行 普通 1234567',
    })
    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.canSend).toBe(false)
    // 送れなくても振込先・支払締切は編集・保存できる必要がある。
    expect(draft.paymentDeadline).toBe('2026-07-25')
    expect(draft.paymentDeadlineKind).toBe('fixed')
    expect(draft.paymentInfo).toBe('〇〇銀行 普通 1234567')
  })

  it('現地払い・支払済も §3.3.5.2 の優先順位で理由が出る（AC-34）', async () => {
    await asAdmin('pnd-admin-7')
    const onsite = await seedPreSettledGroup({ paymentType: 'onsite' })
    expect((await loadPaymentNoticeDraft(onsite.group.id)).unavailableReason).toBe('onsite')

    const paid = await seedPreSettledGroup({ paymentStatus: 'paid' })
    expect((await loadPaymentNoticeDraft(paid.group.id)).unavailableReason).toBe('paid')
  })

  it('LINE 紐付けが無ければ送信不可で理由が返る（AC-35）', async () => {
    await asAdmin('pnd-admin-8')
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
    })
    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.canSend).toBe(false)
    expect(draft.unavailableReason).toBe('no_line_binding')
  })

  it('単価を解決できる級が無ければ送信不可で理由が返る', async () => {
    await asAdmin('pnd-admin-9')
    // 非公認の大会は級別の規定額が導けない。
    const { group } = await seedPreSettledGroup({ official: false })
    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.canSend).toBe(false)
    expect(draft.unavailableReason).toBe('no_priced_grade')
    expect(draft.rows).toEqual([])
  })

  it('送信済みの情報と失敗記録を返す（AC-41 / AC-45）', async () => {
    await asAdmin('pnd-admin-10')
    const { group } = await seedPreSettledGroup()
    await testDb.insert(entryGroupPaymentNotices).values({
      entryGroupId: group.id,
      gradeCounts: { A: 3 },
      totalJpy: 7500,
      lastSentAt: new Date('2026-07-20T01:00:00Z'),
      lastAttemptedAt: new Date('2026-07-21T02:00:00Z'),
      lastError: 'LINE 送信に失敗しました: 500',
    })

    const draft = await loadPaymentNoticeDraft(group.id)
    expect(draft.lastSentAt).toEqual(new Date('2026-07-20T01:00:00Z'))
    expect(draft.lastAttemptedAt).toEqual(new Date('2026-07-21T02:00:00Z'))
    expect(draft.lastError).toBe('LINE 送信に失敗しました: 500')
    // 保存済みの人数が初期値として再現される（AC-47 のグループページ側の裏返し）。
    expect(draft.hasSavedCounts).toBe(true)
    expect(draft.rows.find((r) => r.grade === 'A')?.count).toBe(3)
  })

  it('一般会員は拒否される', async () => {
    const member = await createUser({ name: 'pnd-member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { group } = await seedPreSettledGroup()
    await expect(loadPaymentNoticeDraft(group.id)).rejects.toThrow()
  })
})
