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
})
