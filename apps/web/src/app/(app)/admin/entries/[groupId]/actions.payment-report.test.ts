import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import {
  entryGroupPaymentReceipts,
  entryGroupPaymentReports,
  eventLifecycleNotifications,
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

/**
 * AC-12（金額は `paid` へ倒す前に確定する）は**値の比較では検証できない**。
 * 現在の `tallyEntryFeesForGroup` の母集団は「非中止 ∧ 事前払い」で支払済の日を
 * 除外しないため、順序を入れ替えても金額は動かない。そこで
 * `resolvePaymentReportAmount` を薄く包み、**呼ばれた瞬間の `payment_status`** を
 * 記録して「まだ unpaid だったこと」を直接 assert する。
 */
const hoisted = vi.hoisted(() => ({ statusesAtAmountResolve: [] as string[][] }))

vi.mock('@/lib/events/payment-report-amount', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events/payment-report-amount')>(
    '@/lib/events/payment-report-amount',
  )
  const { testDb: db } = await import('@/test-utils/db')
  const { events: eventsTable } = await import('@kagetra/shared/schema')
  const { eq: equals } = await import('drizzle-orm')
  return {
    ...actual,
    resolvePaymentReportAmount: async (dbc: Parameters<typeof actual.resolvePaymentReportAmount>[0], groupId: number) => {
      const rows = await db
        .select({ status: eventsTable.paymentStatus })
        .from(eventsTable)
        .where(equals(eventsTable.entryGroupId, groupId))
      hoisted.statusesAtAmountResolve.push(rows.map((r) => r.status))
      return actual.resolvePaymentReportAmount(dbc, groupId)
    },
  }
})

const { reportPayment } = await import('./actions')

const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN
const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

/** PNG をその場で作る（固定バイナリを repo に置かない）。 */
async function pngBase64(width = 40, height = 30): Promise<string> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer()
  return buffer.toString('base64')
}

async function seedGroup(dayCount = 1) {
  const group = await createEntryGroup()
  const days = []
  for (let i = 0; i < dayCount; i++) {
    days.push(
      await createEvent({
        entryGroupId: group.id,
        official: true,
        kind: 'individual',
        eligibleGrades: null,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        eventDate: `2030-05-0${i + 1}`,
      }),
    )
  }
  // users.name は UNIQUE。1テスト内で seedGroup を2回呼ぶケースがあるので必ず一意にする。
  const a1 = await createUser({ name: `rp-a1-${crypto.randomUUID()}`, grade: 'A' })
  for (const day of days) await createEventAttendance({ eventId: day.id, userId: a1.id })
  return { group, days }
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

interface PushedMessage {
  type: string
  text?: string
  originalContentUrl?: string
  previewImageUrl?: string
}

/** push 1回ぶんの messages 配列を fetch spy から取り出す（回ごとに分けて返す）。 */
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

async function reportRow(groupId: number) {
  const rows = await testDb
    .select()
    .from(entryGroupPaymentReports)
    .where(eq(entryGroupPaymentReports.entryGroupId, groupId))
  return rows[0]
}

describe('reportPayment', () => {
  beforeEach(async () => {
    await truncateAll()
    hoisted.statusesAtAmountResolve.length = 0
    delete process.env.LINE_NOTIFY_DRY_RUN
    // ★https の PUBLIC_BASE_URL が無いと、証憑ありの経路が「検証したい内容と
    //   無関係な理由」で throw する。
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

  it('証憑0枚は現行と同一（固定文言1通だけ・AC-2）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)

    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [])
      expect(result).toMatchObject({ ok: true, status: 'sent', excluded: [] })

      const batches = pushBatches(fetchSpy)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual([
        { type: 'text', text: '参加費の振り込みが完了しました。' },
      ])
    } finally {
      fetchSpy.mockRestore()
    }

    const day = await testDb.select().from(events).where(eq(events.id, days[0]!.id))
    expect(day[0]!.paymentStatus).toBe('paid')
    const row = await reportRow(group.id)
    expect(row?.receiptCount).toBe(0)
    expect(row?.status).toBe('sent')
    expect(row?.messageText).toBe('参加費の振り込みが完了しました。')
  })

  it('証憑1枚でテキスト1通＋画像1通が同一 push で送られる（AC-3 / AC-6）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)

    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
      expect(result).toMatchObject({ ok: true, status: 'sent', excluded: [] })

      const batches = pushBatches(fetchSpy)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(2)
      expect(batches[0]![0]!.type).toBe('text')
      expect(batches[0]![0]!.text).toContain('参加費の振り込みが完了しました。')
      expect(batches[0]![0]!.text).toContain('添付の明細と金額が一致しているかご確認ください。')
      expect(batches[0]![1]!.type).toBe('image')
      expect(batches[0]![1]!.originalContentUrl).toMatch(
        /^https:\/\/kagetra\.test\/api\/line-broadcast\/payment-receipts\/[A-Za-z0-9_-]{16,64}$/,
      )
      expect(batches[0]![1]!.previewImageUrl).toBe(`${batches[0]![1]!.originalContentUrl}/preview`)
    } finally {
      fetchSpy.mockRestore()
    }

    // PNG で渡しても保存されるのは JPEG（AC-6）。
    const receipts = await testDb.select().from(entryGroupPaymentReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]!.contentType).toBe('image/jpeg')
    expect(receipts[0]!.previewData.byteLength).toBeGreaterThan(0)
  })

  it('4枚目はサーバー側で拒否される（AC-4）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)

    const base64 = await pngBase64()
    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(
        group.id,
        [days[0]!.id],
        Array.from({ length: 4 }, (_, i) => ({ filename: `m${i}.png`, base64 })),
      )
      expect(result).toEqual({ error: '証憑は3枚までです' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }

    // 拒否された呼び出しは状態も記録も一切動かさない。
    const day = await testDb.select().from(events).where(eq(events.id, days[0]!.id))
    expect(day[0]!.paymentStatus).toBe('unpaid')
    expect(await testDb.select().from(entryGroupPaymentReports)).toHaveLength(0)
  })

  it('PDF はサーバー側で除外され、理由が返る（AC-5）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-4' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)

    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [
        {
          filename: 'meisai.pdf',
          base64: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n').toString('base64'),
        },
      ])
      expect(result).toMatchObject({ ok: true })
      expect((result as { excluded: string[] }).excluded).toHaveLength(1)
      expect((result as { excluded: string[] }).excluded[0]).toContain('meisai.pdf')

      // 画像が1枚も残らないので、送られるのは固定文言1通だけ。
      const batches = pushBatches(fetchSpy)
      expect(batches[0]).toEqual([{ type: 'text', text: '参加費の振り込みが完了しました。' }])
    } finally {
      fetchSpy.mockRestore()
    }
    expect(await testDb.select().from(entryGroupPaymentReceipts)).toHaveLength(0)
  })

  it('証憑ありなら claim できなくても送信される（AC-13）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-5' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)
    // 一度支払報告して未払へ戻した状態を再現する（once-ever は消費済み）。
    await testDb
      .insert(eventLifecycleNotifications)
      .values({ eventId: days[0]!.id, type: 'payment_paid', status: 'sent' })

    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
      expect(result).toMatchObject({ ok: true, status: 'sent' })
      const batches = pushBatches(fetchSpy)
      expect(batches).toHaveLength(1)
      expect(batches[0]!.map((m) => m.type)).toEqual(['text', 'image'])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('証憑0枚で claim できないときは送信しない（AC-14 の回帰）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-6' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)
    await testDb
      .insert(eventLifecycleNotifications)
      .values({ eventId: days[0]!.id, type: 'payment_paid', status: 'sent' })

    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [])
      expect(result).toMatchObject({ ok: true, status: 'skipped_unlinked' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('LINE 未連携なら送信せず、状態変更と証憑の保存だけ行う（AC-15）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-7' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    // linkLineGroup を呼ばない = 紐付けなし。

    const fetchSpy = spyOnPush()
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
      expect(result).toMatchObject({ ok: true, status: 'skipped_unlinked' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }

    const day = await testDb.select().from(events).where(eq(events.id, days[0]!.id))
    expect(day[0]!.paymentStatus).toBe('paid')
    const row = await reportRow(group.id)
    expect(row?.status).toBe('skipped_unlinked')
    expect(row?.receiptCount).toBe(1)
    expect(await testDb.select().from(entryGroupPaymentReceipts)).toHaveLength(1)
  })

  it('push 失敗でも paid は維持され、記録に失敗が残る（AC-16）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-8' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(1)
    await linkLineGroup(group.id)

    const fetchSpy = spyOnPush(new Response('boom', { status: 500 }))
    try {
      const result = await reportPayment(group.id, [days[0]!.id], [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
      expect(result).toMatchObject({ ok: true, status: 'failed' })
    } finally {
      fetchSpy.mockRestore()
    }

    const day = await testDb.select().from(events).where(eq(events.id, days[0]!.id))
    expect(day[0]!.paymentStatus).toBe('paid')
    const row = await reportRow(group.id)
    expect(row?.status).toBe('failed')
    expect(row?.lastSentAt).toBeNull()
    expect(row?.errorMessage).not.toBeNull()
  })

  it('金額は paid へ倒す前に確定される（AC-12・複数日）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-9' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, days } = await seedGroup(2)
    await linkLineGroup(group.id)

    const fetchSpy = spyOnPush()
    try {
      await reportPayment(group.id, days.map((d) => d.id), [
        { filename: 'meisai.png', base64: await pngBase64() },
      ])
    } finally {
      fetchSpy.mockRestore()
    }

    // 金額算出の瞬間は2日とも未払だった＝ flip より前に確定している。
    expect(hoisted.statusesAtAmountResolve).toHaveLength(1)
    expect(hoisted.statusesAtAmountResolve[0]).toEqual(['unpaid', 'unpaid'])
    // 実際にはこの後 flip されている。
    const rows = await testDb
      .select({ status: events.paymentStatus })
      .from(events)
      .where(eq(events.entryGroupId, group.id))
    expect(rows.map((r) => r.status)).toEqual(['paid', 'paid'])
  })

  it('非管理者は Forbidden（AC-21）', async () => {
    const member = await createUser({ name: 'rp-member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { group, days } = await seedGroup(1)

    await expect(reportPayment(group.id, [days[0]!.id], [])).rejects.toThrow('Forbidden')
    expect(await testDb.select().from(entryGroupPaymentReports)).toHaveLength(0)
  })

  it('別グループの日を混ぜた呼び出しは拒否される（fail-closed）', async () => {
    const admin = await createAdmin({ name: 'rp-admin-10' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedGroup(1)
    const other = await seedGroup(1)

    const result = await reportPayment(group.id, [other.days[0]!.id], [])
    expect(result).toEqual({ error: 'このグループの日ではありません' })
  })
})
