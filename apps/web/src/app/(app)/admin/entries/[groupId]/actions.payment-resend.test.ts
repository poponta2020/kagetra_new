import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import {
  entryGroupPaymentReceipts,
  entryGroupPaymentReports,
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

const { reportPayment, resendPaymentReport } = await import('./actions')

const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN
const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

async function pngBase64(): Promise<string> {
  const buffer = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 90, b: 200 } },
  })
    .png()
    .toBuffer()
  return buffer.toString('base64')
}

async function seedLinkedGroup() {
  const group = await createEntryGroup()
  const day = await createEvent({
    entryGroupId: group.id,
    official: true,
    kind: 'individual',
    eligibleGrades: null,
    entryStatus: 'applied',
    paymentType: 'advance',
    paymentStatus: 'unpaid',
  })
  const user = await createUser({ name: `rs-a1-${crypto.randomUUID()}`, grade: 'A' })
  await createEventAttendance({ eventId: day.id, userId: user.id })

  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      botId: `@bot-${group.id}`,
      channelId: `cid-${group.id}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: group.id,
    })
    .returning()
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId: group.id,
    lineChannelId: channel!.id,
    lineGroupId: `G-${group.id}`,
    status: 'linked',
  })
  return { group, day }
}

interface PushedMessage {
  type: string
  text?: string
  originalContentUrl?: string
  previewImageUrl?: string
}

function pushBatches(spy: { mock: { calls: unknown[][] } }): PushedMessage[][] {
  return spy.mock.calls.flatMap((call) => {
    const init = call[1] as RequestInit | undefined
    if (typeof init?.body !== 'string') return []
    const body = JSON.parse(init.body) as { messages?: PushedMessage[] }
    return body.messages ? [body.messages] : []
  })
}

function spyOnPush(response = new Response(null, { status: 200 })) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
}

describe('resendPaymentReport', () => {
  beforeEach(async () => {
    await truncateAll()
    delete process.env.LINE_NOTIFY_DRY_RUN
    process.env.PUBLIC_BASE_URL = 'https://kagetra.test'
  })

  afterEach(() => {
    if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
    if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('保存済み文面がそのまま送られ、集計が変わっても文面は揺れない（AC-18）', async () => {
    const admin = await createAdmin({ name: 'rs-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()

    let firstText = ''
    let firstImageUrl = ''
    const fetchSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
      const first = pushBatches(fetchSpy)[0]!
      firstText = first[0]!.text!
      firstImageUrl = first[1]!.originalContentUrl!
      expect(firstText).toContain('景虎上の想定金額は')
    } finally {
      fetchSpy.mockRestore()
    }

    // 再送の前に「いまの集計」を動かす: 参加者を1名増やす。
    const extra = await createUser({ name: `rs-a2-${crypto.randomUUID()}`, grade: 'A' })
    await createEventAttendance({ eventId: day.id, userId: extra.id })

    const [report] = await testDb
      .select()
      .from(entryGroupPaymentReports)
      .where(eq(entryGroupPaymentReports.entryGroupId, group.id))

    const resendSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(report!.id)
      expect(result).toMatchObject({ ok: true, status: 'sent' })

      const batches = pushBatches(resendSpy)
      expect(batches).toHaveLength(1)
      // 文面はスナップショットのまま（集計が増えても揺れない）。
      expect(batches[0]![0]).toEqual({ type: 'text', text: firstText })
      // 画像も同じ枚数・同じトークン。
      expect(batches[0]).toHaveLength(2)
      expect(batches[0]![1]!.originalContentUrl).toBe(firstImageUrl)
    } finally {
      resendSpy.mockRestore()
    }
  })

  it('成功で status=sent・last_sent_at が進む', async () => {
    const admin = await createAdmin({ name: 'rs-admin-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()

    // まず送信失敗させて failed の記録を作る。
    const failSpy = spyOnPush(new Response('boom', { status: 500 }))
    try {
      await reportPayment(group.id, [day.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
    } finally {
      failSpy.mockRestore()
    }
    const [failed] = await testDb
      .select()
      .from(entryGroupPaymentReports)
      .where(eq(entryGroupPaymentReports.entryGroupId, group.id))
    expect(failed!.status).toBe('failed')
    expect(failed!.lastSentAt).toBeNull()

    const okSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(failed!.id)
      expect(result).toMatchObject({ ok: true, status: 'sent' })
    } finally {
      okSpy.mockRestore()
    }

    const [after] = await testDb
      .select()
      .from(entryGroupPaymentReports)
      .where(eq(entryGroupPaymentReports.id, failed!.id))
    expect(after!.status).toBe('sent')
    expect(after!.lastSentAt).not.toBeNull()
    expect(after!.errorMessage).toBeNull()
    // 支払状態は再送で動かさない。
    const [row] = await testDb.select().from(events).where(eq(events.id, day.id))
    expect(row!.paymentStatus).toBe('paid')
  })

  it('証憑0枚の報告でも再送では必ず送られる', async () => {
    const admin = await createAdmin({ name: 'rs-admin-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()

    const firstSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [])
    } finally {
      firstSpy.mockRestore()
    }
    const [report] = await testDb
      .select()
      .from(entryGroupPaymentReports)
      .where(eq(entryGroupPaymentReports.entryGroupId, group.id))
    expect(report!.receiptCount).toBe(0)

    const resendSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(report!.id)
      expect(result).toMatchObject({ ok: true, status: 'sent' })
      const batches = pushBatches(resendSpy)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual([{ type: 'text', text: '参加費の振り込みが完了しました。' }])
    } finally {
      resendSpy.mockRestore()
    }
  })

  it('未払に戻しても記録と証憑は残り、再送できる（AC-19）', async () => {
    const admin = await createAdmin({ name: 'rs-admin-4' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()

    const firstSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
    } finally {
      firstSpy.mockRestore()
    }

    const { setPaymentsPaid } = await import('../../../events/[id]/actions')
    await setPaymentsPaid([day.id], false)

    const [row] = await testDb.select().from(events).where(eq(events.id, day.id))
    expect(row!.paymentStatus).toBe('unpaid')
    expect(await testDb.select().from(entryGroupPaymentReports)).toHaveLength(1)
    expect(await testDb.select().from(entryGroupPaymentReceipts)).toHaveLength(1)

    const [report] = await testDb.select().from(entryGroupPaymentReports)
    const resendSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(report!.id)
      expect(result).toMatchObject({ ok: true, status: 'sent' })
    } finally {
      resendSpy.mockRestore()
    }
  })

  it('LINE 未連携なら送らず skipped_unlinked', async () => {
    const admin = await createAdmin({ name: 'rs-admin-5' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    const day = await createEvent({
      entryGroupId: group.id,
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      entryStatus: 'applied',
    })

    const firstSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [])
    } finally {
      firstSpy.mockRestore()
    }
    const [report] = await testDb.select().from(entryGroupPaymentReports)

    const resendSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(report!.id)
      expect(result).toMatchObject({ ok: true, status: 'skipped_unlinked' })
      expect(resendSpy).not.toHaveBeenCalled()
    } finally {
      resendSpy.mockRestore()
    }
  })

  it('非管理者は Forbidden（AC-21）', async () => {
    const admin = await createAdmin({ name: 'rs-admin-6' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()
    const firstSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [])
    } finally {
      firstSpy.mockRestore()
    }
    const [report] = await testDb.select().from(entryGroupPaymentReports)

    const member = await createUser({ name: `rs-member-${crypto.randomUUID()}` })
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(resendPaymentReport(report!.id)).rejects.toThrow('Forbidden')
  })

  it('存在しない報告 id はエラーを返す', async () => {
    const admin = await createAdmin({ name: 'rs-admin-7' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    expect(await resendPaymentReport(999999)).toEqual({ error: '支払報告が見つかりません' })
  })

  it('送信中の報告は再送できない（重複配信の防止）', async () => {
    const admin = await createAdmin({ name: 'rs-admin-8' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()

    const firstSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [])
    } finally {
      firstSpy.mockRestore()
    }
    const [report] = await testDb.select().from(entryGroupPaymentReports)

    // 別の実行が送信権を握っている状態を再現する。
    await testDb
      .update(entryGroupPaymentReports)
      .set({ status: 'sending', updatedAt: new Date() })
      .where(eq(entryGroupPaymentReports.id, report!.id))

    const resendSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(report!.id)
      expect(result).toEqual({
        error: 'この支払報告は送信中です。しばらく待ってからもう一度お試しください',
      })
      expect(resendSpy).not.toHaveBeenCalled()
    } finally {
      resendSpy.mockRestore()
    }
  })

  it('送信中のまま放置された行は一定時間後に再び再送できる（永久ロックにしない）', async () => {
    const admin = await createAdmin({ name: 'rs-admin-9' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedLinkedGroup()

    const firstSpy = spyOnPush()
    try {
      await reportPayment(group.id, [day.id], [])
    } finally {
      firstSpy.mockRestore()
    }
    const [report] = await testDb.select().from(entryGroupPaymentReports)

    // 6分前に sending のまま落ちた実行を再現する（閾値は5分）。
    await testDb
      .update(entryGroupPaymentReports)
      .set({ status: 'sending', updatedAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(entryGroupPaymentReports.id, report!.id))

    const resendSpy = spyOnPush()
    try {
      const result = await resendPaymentReport(report!.id)
      expect(result).toMatchObject({ ok: true, status: 'sent' })
    } finally {
      resendSpy.mockRestore()
    }
  })
})
