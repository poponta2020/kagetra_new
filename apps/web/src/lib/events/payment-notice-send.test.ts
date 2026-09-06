import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroupPaymentNotices,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup } from '@/test-utils/seed'
import { sendPaymentNoticeCore } from './payment-notice-send'

/**
 * 振込連絡の送信本体（line-bot-message-revamp §3.3.4 / §3.3.5.6）。
 *
 * 2導線が共有する処理なので、ここでは**導線に依らない性質**だけを見る:
 * 全級0名・push 直前の中止・成否の記録。露出条件は
 * `payment-notice-context.test.ts`、Server Action の認可は
 * `payment-notice-actions.test.ts` が持つ。
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

async function noticeRow(entryGroupId: number) {
  return testDb.query.entryGroupPaymentNotices.findFirst({
    where: eq(entryGroupPaymentNotices.entryGroupId, entryGroupId),
  })
}

const UNIT_PRICES = { A: 2500, B: 2500 } as const

describe('sendPaymentNoticeCore', () => {
  const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN

  beforeEach(async () => {
    await truncateAll()
    delete process.env.LINE_NOTIFY_DRY_RUN
  })
  afterEach(() => {
    if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
  })
  afterAll(async () => {
    await closeTestDb()
  })

  async function seed() {
    const admin = await createAdmin({ name: `pnc-admin-${Date.now()}` })
    const group = await createEntryGroup()
    await linkLineGroup(group.id)
    return { admin, group }
  }

  function input(groupId: number, adminId: string, counts: Record<string, number>) {
    return {
      entryGroupId: groupId,
      counts,
      unitPriceByGrade: UNIT_PRICES,
      paymentDeadlineIso: '2026-07-25',
      paymentInfo: '〇〇銀行 普通 1234567',
      sentByUserId: adminId,
    }
  }

  it('全級0名なら送らず、記録も作らない（AC-18）', async () => {
    const { admin, group } = await seed()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const result = await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 0 }))
      expect(result).toEqual({ outcome: 'empty' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
    // total_jpy は NOT NULL。0 円の送信記録を生やさない。
    expect(await noticeRow(group.id)).toBeUndefined()
  })

  it('abortBeforePush が中止を指示したら push しない（AC-46 の土台）', async () => {
    const { admin, group } = await seed()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const result = await sendPaymentNoticeCore(testDb, {
        ...input(group.id, admin.id, { A: 2 }),
        abortBeforePush: async () => true,
      })
      expect(result).toEqual({ outcome: 'aborted' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
    // 人数は push の前に保存する規律なので、中止でも保存済みのまま残る。
    const row = await noticeRow(group.id)
    expect(row?.gradeCounts).toEqual({ A: 2 })
    expect(row?.lastSentAt).toBeNull()
    // 中止は失敗ではないので、失敗記録は書かない。
    expect(row?.lastError).toBeNull()
  })

  it('人数は push の前に保存される（失敗しても数え直させない）', async () => {
    const { admin, group } = await seed()
    let savedAtPushTime: unknown = null
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      savedAtPushTime = (await noticeRow(group.id))?.gradeCounts
      return new Response('boom', { status: 500 })
    })
    try {
      const result = await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 2 }))
      expect(result.outcome).toBe('failed')
    } finally {
      fetchSpy.mockRestore()
    }
    expect(savedAtPushTime).toEqual({ A: 2 })
  })

  it('紐付けが無ければ failed として記録する', async () => {
    const admin = await createAdmin({ name: 'pnc-admin-nolink' })
    const group = await createEntryGroup()
    const result = await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 1 }))
    expect(result).toEqual({
      outcome: 'failed',
      error: 'LINE グループが紐付いていません',
    })
    expect((await noticeRow(group.id))?.lastError).toBe('LINE グループが紐付いていません')
  })
  // ★Codex R3 blocker: total_jpy は「会計へ伝えた金額」の監査スナップショットで、
  // payment-report-amount.ts が last_sent_at 非 NULL のときの想定金額に採用する。
  // 再送失敗でここが書き換わると、届いていない金額が会員向け通知へ載る。
  it('再送に失敗しても、成功済みの total_jpy を書き換えない', async () => {
    const { admin, group } = await seed()
    const ok = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 2 }))
    } finally {
      ok.mockRestore()
    }
    const sent = await noticeRow(group.id)
    expect(sent?.totalJpy).toBe(5000)
    expect(sent?.lastSentAt).not.toBeNull()

    // 人数を 3 名へ直して再送 → push 失敗。
    const failing = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 500 }))
    try {
      const result = await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 3 }))
      expect(result.outcome).toBe('failed')
    } finally {
      failing.mockRestore()
    }

    const after = await noticeRow(group.id)
    // 人数（再入力用）は新しい値で残るが、伝えた金額は 5000 円のまま。
    expect(after?.gradeCounts).toEqual({ A: 3 })
    expect(after?.totalJpy).toBe(5000)
    expect(after?.lastError).toBeTruthy()
  })

  it('成功したときだけ total_jpy が進む', async () => {
    const { admin, group } = await seed()
    const ok = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 2 }))
      await sendPaymentNoticeCore(testDb, input(group.id, admin.id, { A: 3 }))
    } finally {
      ok.mockRestore()
    }
    expect((await noticeRow(group.id))?.totalJpy).toBe(7500)
  })

  // ★Codex R3 blocker: pushMessagesToEntryGroup は LINE API を叩く前に紐付けを DB から
  // 引く。事前の1回だけでは、その待機中の取り消しを拾えない。
  it('紐付け取得の待機中に中止が確定したら push しない', async () => {
    const { admin, group } = await seed()
    let calls = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const result = await sendPaymentNoticeCore(testDb, {
        ...input(group.id, admin.id, { A: 2 }),
        // 1回目（コア冒頭）は続行、2回目（push 直前・紐付け取得の後）で中止。
        abortBeforePush: async () => {
          calls += 1
          return calls >= 2
        },
      })
      expect(result).toEqual({ outcome: 'aborted' })
      expect(calls).toBe(2)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
    // 中止は失敗ではないので失敗記録を書かない。
    const row = await noticeRow(group.id)
    expect(row?.lastError).toBeNull()
    expect(row?.lastSentAt).toBeNull()
  })
})
