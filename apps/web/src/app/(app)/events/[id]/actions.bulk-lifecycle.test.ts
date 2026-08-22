import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  events,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup, createEvent } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * entry-groups タスク4 (Issue #363): 進行操作の一括化 + 通知集約。
 * 対応 AC: AC-8（一括 flip+claim+1通集約）・AC-9（部分選択→後追い分のみ通知）・
 * AC-10（支払い系）・AC-11（cancelled 除外）。
 *
 * `setEntryApplied` / `setPaymentPaid` / `setPaymentType`（N=1 の薄いラッパー
 * 経由の文面バイト互換）は `lifecycle-actions.test.ts`（既存・無編集）が担保する。
 * このファイルは新設の bulk 版だけを対象にする。
 */

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { setEntriesApplied, setPaymentsPaid, setPaymentTypes } = await import('./actions')

async function seedMultiDayGroup(
  overrides: Array<Partial<Parameters<typeof createEvent>[0]>> = [{}, {}],
): Promise<{ ids: number[]; entryGroupId: number }> {
  const { id: entryGroupId } = await createEntryGroup()
  const ids: number[] = []
  for (const [i, override] of overrides.entries()) {
    const ev = await createEvent({
      title: i === 0 ? 'C級' : 'D級',
      eventDate: i === 0 ? '2026-08-01' : '2026-08-08',
      entryGroupId,
      ...override,
    })
    ids.push(ev.id)
  }
  return { ids, entryGroupId }
}

async function seedLinkedChannel(entryGroupId: number, lineGroupId = 'Gbulk') {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: '@bulk-bot',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: entryGroupId,
    })
    .returning()
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId,
    lineChannelId: channel!.id,
    status: 'linked',
    lineGroupId,
    linkedAt: new Date(),
  })
}

async function getEvent(id: number) {
  return testDb.query.events.findFirst({ where: eq(events.id, id) })
}

async function notificationsFor(eventIds: number[]) {
  const rows = await testDb.select().from(eventLifecycleNotifications)
  return rows.filter((r) => eventIds.includes(r.eventId))
}

interface FetchSpyLike {
  mock: { calls: Array<[unknown, unknown?]> }
}

function fetchMessages(fetchSpy: FetchSpyLike): string[] {
  return fetchSpy.mock.calls.map(([, init]) => {
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
      messages: Array<{ type: string; text?: string }>
    }
    return body.messages[0]?.text ?? ''
  })
}

describe('entry-groups タスク4 — 進行操作の一括化 + 通知集約', () => {
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

  describe('AC-8: 一括 flip + claim + 1通集約', () => {
    it('選択した2日を同一操作で flip し、参加者向け・会計向けとも1通に集約される', async () => {
      delete process.env.LINE_NOTIFY_DRY_RUN
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids, entryGroupId } = await seedMultiDayGroup()
      await seedLinkedChannel(entryGroupId)

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }))
      try {
        await setEntriesApplied(ids, true)

        // push は参加者向け1回 + 会計向け1回の計2回（2日分でも4回にならない）。
        // ★ fetchSpy.mockRestore() は mockClear() も兼ねるため、assertion は
        // 必ず restore の前（try 内）で行うこと（line-broadcast.test.ts と同じ規律）。
        expect(fetchSpy).toHaveBeenCalledTimes(2)
        const messages = fetchMessages(fetchSpy)
        // 参加者向け（entry_applied）は line-bot-message-revamp タスク5（2026-08-22）で
        // 大会名・日別ラベルを一切出さなくなったため、常に同一の固定文言になる。
        expect(
          messages.some((m) => m === '申し込みが完了しました！\n\n抽選日は未定です。'),
        ).toBe(true)
        // 会計向け（entry_applied_treasurer、タスク6管轄・未変更）は引き続き
        // 大会名を含む日別ラベルを列挙する。
        expect(
          messages.some((m) => m.includes('8/1(土)C級') && m.includes('8/8(土)D級')),
        ).toBe(true)
      } finally {
        fetchSpy.mockRestore()
      }

      for (const id of ids) {
        const row = await getEvent(id)
        expect(row?.entryStatus).toBe('applied')
        expect(row?.entryAppliedAt).not.toBeNull()
      }

      // claim ログは (event,type) 単位で 2日 × 2種別 = 4行、全て sent。
      const logs = await notificationsFor(ids)
      expect(logs).toHaveLength(4)
      expect(logs.every((l) => l.status === 'sent' && l.lineGroupId === 'Gbulk')).toBe(true)
    })
  })

  describe('AC-9: 部分選択後の追加適用は新規 claim 分のみの1通', () => {
    it('day1 を先に申込済にした後、day1+day2 を選択しても day2 分だけの通知になる', async () => {
      delete process.env.LINE_NOTIFY_DRY_RUN
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids, entryGroupId } = await seedMultiDayGroup()
      const [day1, day2] = ids as [number, number]
      await seedLinkedChannel(entryGroupId)

      const firstFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }))
      try {
        await setEntriesApplied([day1], true)
        expect(firstFetch).toHaveBeenCalledTimes(2) // 参加者向け+会計向け
      } finally {
        firstFetch.mockRestore()
      }

      const secondFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }))
      try {
        await setEntriesApplied([day1, day2], true)

        // 既に applied だった day1 は今回の flip 対象にすらならない（0件 UPDATE）
        // ため、通知も day2 分だけの1通×2種別（参加者+会計）= 2回の push で済む。
        expect(secondFetch).toHaveBeenCalledTimes(2)
        const messages = fetchMessages(secondFetch)
        // 参加者向け（entry_applied）は大会名を出さないため固定文言（day1/day2 の
        // 区別自体が文面上は無くなった）。会計向け（entry_applied_treasurer、
        // タスク6管轄・未変更）は引き続き大会名を載せるので、既送の day1 (C級) を
        // 含まず新規 claim の day2 (D級) だけが載ることをそちらで確認する。
        expect(
          messages.some((m) => m === '申し込みが完了しました！\n\n抽選日は未定です。'),
        ).toBe(true)
        const treasurerMessage = messages.find((m) => m.includes('会計の方へ'))!
        expect(treasurerMessage).toContain('D級')
        expect(treasurerMessage).not.toContain('C級')
      } finally {
        secondFetch.mockRestore()
      }

      expect((await getEvent(day2))?.entryStatus).toBe('applied')
      // ログ行は day1(2) + day2(2) = 4行のまま（day1 の再 INSERT は起きない）。
      const logs = await notificationsFor(ids)
      expect(logs).toHaveLength(4)
    })
  })

  describe('AC-10: 支払い系（支払済・支払いタイプ設定）の一括ダイアログ集約', () => {
    it('setPaymentTypes で2日とも advance にしてから setPaymentsPaid で一括支払済 + 1通', async () => {
      process.env.LINE_NOTIFY_DRY_RUN = '1'
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids, entryGroupId } = await seedMultiDayGroup()
      await seedLinkedChannel(entryGroupId)

      await setPaymentTypes(ids, 'advance')
      for (const id of ids) {
        expect((await getEvent(id))?.paymentType).toBe('advance')
      }

      await setPaymentsPaid(ids, true)
      for (const id of ids) {
        const row = await getEvent(id)
        expect(row?.paymentStatus).toBe('paid')
        expect(row?.paymentPaidAt).not.toBeNull()
      }

      const logs = (await notificationsFor(ids)).filter((l) => l.type === 'payment_paid')
      expect(logs).toHaveLength(2) // 2日 × payment_paid 1種別
      expect(logs.every((l) => l.status === 'sent')).toBe(true)
    })

    it('setPaymentsPaid(false) は通知を送らない（誤操作の戻し用）', async () => {
      process.env.LINE_NOTIFY_DRY_RUN = '1'
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids, entryGroupId } = await seedMultiDayGroup()
      await seedLinkedChannel(entryGroupId)
      await setPaymentTypes(ids, 'advance')
      await setPaymentsPaid(ids, true)

      await setPaymentsPaid(ids, false)
      for (const id of ids) {
        expect((await getEvent(id))?.paymentStatus).toBe('unpaid')
      }
      // once-ever ログは削除されない（既存の単一版と同じ方針）。
      const logs = (await notificationsFor(ids)).filter((l) => l.type === 'payment_paid')
      expect(logs).toHaveLength(2)
    })
  })

  describe('AC-11: cancelled のイベントは claim もされない（状態は記録する）', () => {
    it('cancelled を含む一括申込済で、cancelled の日は flip されるが通知ログが作られない', async () => {
      process.env.LINE_NOTIFY_DRY_RUN = '1'
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids, entryGroupId } = await seedMultiDayGroup([
        {},
        { status: 'cancelled' },
      ])
      const [day1, day2Cancelled] = ids as [number, number]
      await seedLinkedChannel(entryGroupId)

      await setEntriesApplied([day1, day2Cancelled], true)

      // 状態自体はクライアント申告どおり両方 flip される（cancelled でも記録する）。
      expect((await getEvent(day1))?.entryStatus).toBe('applied')
      expect((await getEvent(day2Cancelled))?.entryStatus).toBe('applied')

      const day1Logs = await notificationsFor([day1])
      const day2Logs = await notificationsFor([day2Cancelled])
      expect(day1Logs).toHaveLength(2) // entry_applied + entry_applied_treasurer
      expect(day1Logs.every((l) => l.status === 'sent')).toBe(true)
      expect(day2Logs).toHaveLength(0) // cancelled は claim もされない
    })
  })

  describe('未 linked のグループは一括操作でも全日 skipped で claim される', () => {
    it('LINE 未紐付けの2日を一括申込済にすると、4行とも skipped で記録される', async () => {
      process.env.LINE_NOTIFY_DRY_RUN = '1'
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids } = await seedMultiDayGroup()

      await setEntriesApplied(ids, true)

      for (const id of ids) {
        expect((await getEvent(id))?.entryStatus).toBe('applied')
      }
      const logs = await notificationsFor(ids)
      expect(logs).toHaveLength(4)
      expect(logs.every((l) => l.status === 'skipped')).toBe(true)
    })
  })

  describe('グループ外の id はフェイルクローズで除外される', () => {
    it('別グループの id を混ぜても、そちらは flip されない', async () => {
      process.env.LINE_NOTIFY_DRY_RUN = '1'
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { ids } = await seedMultiDayGroup()
      const other = await createEvent({ title: '別グループ', eventDate: '2026-09-01' })

      await setEntriesApplied([...ids, other.id], true)

      for (const id of ids) {
        expect((await getEvent(id))?.entryStatus).toBe('applied')
      }
      expect((await getEvent(other.id))?.entryStatus).toBe('not_applied')
    })
  })
})
