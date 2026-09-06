import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroups,
  entryGroupPaymentNotices,
  eventLineBroadcasts,
  events,
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { sendPaymentNotice } = await import('./actions')

/**
 * 振込連絡の送信（line-bot-message-revamp §3.3.4）。
 *
 * 露出条件・初期値の判定は `lib/events/payment-notice-context.test.ts` が持つ。
 * ここが持つのは **送信の副作用**（保存・last_sent_at・push 失敗時の扱い・認可）。
 */

async function seedDueGroup() {
  const group = await createEntryGroup()
  await testDb
    .update(entryGroups)
    .set({ confirmedRosterOverride: true })
    .where(eq(entryGroups.id, group.id))
  const event = await createEvent({
    entryGroupId: group.id,
    official: true,
    kind: 'individual',
    eligibleGrades: null,
    entryStatus: 'applied',
    paymentType: 'advance',
    paymentStatus: 'unpaid',
    paymentDeadline: '2026-07-25',
    paymentDeadlineKind: 'fixed',
    paymentInfo: '〇〇銀行 普通 1234567',
  })
  const a1 = await createUser({ name: 'pna-1', grade: 'A' })
  const a2 = await createUser({ name: 'pna-2', grade: 'A' })
  for (const u of [a1, a2]) {
    await createEventAttendance({ eventId: event.id, userId: u.id })
  }
  return { group, event }
}

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

async function noticeRow(entryGroupId: number) {
  return testDb.query.entryGroupPaymentNotices.findFirst({
    where: eq(entryGroupPaymentNotices.entryGroupId, entryGroupId),
  })
}

/** push された messages を fetch spy から取り出す。 */
function pushedMessages(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.flatMap((call) => {
    const init = call[1] as RequestInit | undefined
    if (typeof init?.body !== 'string') return []
    const body = JSON.parse(init.body) as { messages?: { type: string; text: string }[] }
    return body.messages ?? []
  })
}

describe('sendPaymentNotice', () => {
  const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN

  beforeEach(async () => {
    await truncateAll()
  })
  afterEach(() => {
    if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('送信すると人数が保存され、last_sent_at が入る', async () => {
    delete process.env.LINE_NOTIFY_DRY_RUN
    const admin = await createAdmin({ name: 'pna-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      const result = await sendPaymentNotice(group.id, { A: 2 })
      expect(result).toEqual({ ok: true })

      // 1通目（数値のみ）＋2通目（支払情報の自由記述）で2通。
      const messages = pushedMessages(fetchSpy)
      expect(messages).toHaveLength(2)
      expect(messages[0]!.text).toContain('A級：2500*2 = 5000円')
      expect(messages[0]!.text).toContain('計5000円')
      expect(messages[1]).toEqual({ type: 'text', text: '〇〇銀行 普通 1234567' })
    } finally {
      fetchSpy.mockRestore()
    }

    const row = await noticeRow(group.id)
    expect(row?.gradeCounts).toEqual({ A: 2 })
    expect(row?.totalJpy).toBe(5000)
    expect(row?.lastSentAt).not.toBeNull()
    expect(row?.lastSentBy).toBe(admin.id)
  })

  it('管理者が直した人数で金額が組み立てられる（単価は上書きできない・AC-13）', async () => {
    delete process.env.LINE_NOTIFY_DRY_RUN
    const admin = await createAdmin({ name: 'pna-admin-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      // 集計は2名だが、抽選で1名落ちたので1名へ直す。
      await sendPaymentNotice(group.id, { A: 1 })
      const messages = pushedMessages(fetchSpy)
      expect(messages[0]!.text).toContain('A級：2500*1 = 2500円')
    } finally {
      fetchSpy.mockRestore()
    }

    // 単価は保存しない（協会規定額から都度導出する）。
    const row = await noticeRow(group.id)
    expect(row?.gradeCounts).toEqual({ A: 1 })
    expect(row?.totalJpy).toBe(2500)
  })

  it('push 失敗時は送信済みにならず、人数だけ残る（AC-19）', async () => {
    delete process.env.LINE_NOTIFY_DRY_RUN
    const admin = await createAdmin({ name: 'pna-admin-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 500 }))
    try {
      const result = await sendPaymentNotice(group.id, { A: 2 })
      expect(result.ok).toBeUndefined()
      expect(result.error).toBeTruthy()
    } finally {
      fetchSpy.mockRestore()
    }

    const row = await noticeRow(group.id)
    // 人数は残す（やり直しのたびに数え直させない）が、送信済みにはしない。
    expect(row?.gradeCounts).toEqual({ A: 2 })
    expect(row?.lastSentAt).toBeNull()
    expect(row?.lastSentBy).toBeNull()
  })

  it('人数が全級0なら送信しない（AC-18）', async () => {
    delete process.env.LINE_NOTIFY_DRY_RUN
    const admin = await createAdmin({ name: 'pna-admin-4' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const result = await sendPaymentNotice(group.id, { A: 0 })
      expect(result.error).toBeTruthy()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
    expect(await noticeRow(group.id)).toBeUndefined()
  })

  it('露出条件を満たさないグループでは拒否する（支払済・AC-11 の裏側）', async () => {
    const admin = await createAdmin({ name: 'pna-admin-5' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, event } = await seedDueGroup()
    await linkLineGroup(group.id)
    await testDb.update(events).set({ paymentStatus: 'paid' }).where(eq(events.id, event.id))

    const result = await sendPaymentNotice(group.id, { A: 2 })
    expect(result.error).toBeTruthy()
    expect(await noticeRow(group.id)).toBeUndefined()
  })

  it('LINE 紐付けが無ければ送らない', async () => {
    const admin = await createAdmin({ name: 'pna-admin-6' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()

    const result = await sendPaymentNotice(group.id, { A: 2 })
    expect(result.error).toBeTruthy()
    expect(await noticeRow(group.id)).toBeUndefined()
  })

  it('一般会員は拒否される', async () => {
    const member = await createUser({ name: 'pna-member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    await expect(sendPaymentNotice(group.id, { A: 2 })).rejects.toThrow()
    expect(await noticeRow(group.id)).toBeUndefined()
  })
  it('push 失敗を試行記録に残す（AC-45）', async () => {
    delete process.env.LINE_NOTIFY_DRY_RUN
    const admin = await createAdmin({ name: 'pna-admin-7' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 500 }))
    try {
      await sendPaymentNotice(group.id, { A: 2 })
    } finally {
      fetchSpy.mockRestore()
    }

    const row = await noticeRow(group.id)
    expect(row?.lastSentAt).toBeNull()
    expect(row?.lastAttemptedAt).not.toBeNull()
    expect(row?.lastError).toContain('LINE 送信に失敗しました')
  })

  it('再送に成功すると失敗記録が消える（AC-45b）', async () => {
    delete process.env.LINE_NOTIFY_DRY_RUN
    const admin = await createAdmin({ name: 'pna-admin-8' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedDueGroup()
    await linkLineGroup(group.id)

    const failing = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 500 }))
    try {
      await sendPaymentNotice(group.id, { A: 2 })
    } finally {
      failing.mockRestore()
    }
    expect((await noticeRow(group.id))?.lastError).toBeTruthy()

    const ok = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      expect(await sendPaymentNotice(group.id, { A: 2 })).toEqual({ ok: true })
    } finally {
      ok.mockRestore()
    }

    const row = await noticeRow(group.id)
    // 「送信済」と「送信に失敗しました」が同時に出る状態を作らない。
    expect(row?.lastSentAt).not.toBeNull()
    expect(row?.lastError).toBeNull()
  })
})
