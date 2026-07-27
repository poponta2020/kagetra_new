import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { eventLineBroadcasts, events, lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent } from '@/test-utils/seed'
import { releaseExpiredBroadcasts } from '../release-expired-broadcasts'

afterAll(async () => {
  await closeTestDb()
})

beforeEach(async () => {
  await truncateAll()
})

/**
 * entry-groups タスク3: 複数日グループの linked binding を1件 seed する。
 * `eventDates` の全イベントを同一 entry_group_id に紐付け、broadcast 行は
 * グループにつき1件（entry_group_id が UNIQUE）。
 */
async function seedLinkedGroup(eventDates: readonly string[]): Promise<{
  entryGroupId: number
  channelId: number
  broadcastId: number
}> {
  const { id: entryGroupId } = await createEntryGroup()
  for (const eventDate of eventDates) {
    await createEvent({ title: `日程 ${eventDate}`, eventDate, entryGroupId })
  }
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${Math.random().toString(36).slice(2, 10)}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: '@test-bot',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: entryGroupId,
    })
    .returning({ id: lineChannels.id })
  const [broadcast] = await testDb
    .insert(eventLineBroadcasts)
    .values({
      entryGroupId,
      lineChannelId: channel!.id,
      status: 'linked',
      lineGroupId: 'Gtest',
      linkedAt: new Date(),
    })
    .returning({ id: eventLineBroadcasts.id })
  return { entryGroupId, channelId: channel!.id, broadcastId: broadcast!.id }
}

describe('releaseExpiredBroadcasts — entry-groups タスク3: グループ内 MAX(event_date) 判定', () => {
  it('複数日グループでは最も遅い開催日 (9/20) +30日を基準にする（早い方の8/1基準では解放しない）', async () => {
    const { broadcastId, channelId } = await seedLinkedGroup(['2026-08-01', '2026-09-20'])

    // 8/1 + 30 = 8/31（既に過ぎている）が誤って基準に使われていたら解放されて
    // しまう日付。9/20 + 30 = 10/20 なのでまだ解放されないはず。
    const result = await releaseExpiredBroadcasts(testDb, { today: '2026-09-05' })

    expect(result.releasedBroadcastIds).not.toContain(broadcastId)
    expect(result.releasedCount).toBe(0)

    const row = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.id, broadcastId),
    })
    expect(row?.status).toBe('linked')

    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('active')
  })

  it('MAX(event_date) (9/20) + 30日を過ぎたら解放される', async () => {
    const { broadcastId, channelId } = await seedLinkedGroup([
      '2026-08-01',
      '2026-09-20',
    ])

    const result = await releaseExpiredBroadcasts(testDb, { today: '2026-10-21' })

    expect(result.releasedBroadcastIds).toContain(broadcastId)
    expect(result.releasedCount).toBe(1)

    const row = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.id, broadcastId),
    })
    expect(row?.status).toBe('released')
    expect(row?.releasedAt).not.toBeNull()

    // channel はこのグループへの割当が解除されプールへ戻る。
    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('available')
    expect(channel?.assignedEntryGroupId).toBeNull()
  })

  // r1 review blocker の派生: 付け替えで events 0件になったグループは
  // `deleteGroupIfEmpty` が削除しない（紐付けを残す要件）。MAX(event_date) が NULL に
  // なるため、この分岐が無いと COALESCE も NULL → 比較不成立で永久に解放されず
  // Bot がプールに戻らなくなる。
  it('r1: イベント0件のグループ（付け替えで空になった）は即解放されて Bot がプールへ戻る', async () => {
    const { broadcastId, channelId, entryGroupId } = await seedLinkedGroup(['2026-08-01'])
    // 唯一のイベントを別グループへ移す（= 合流。移動元は空になるが紐付けは残る）。
    const other = await createEntryGroup()
    await testDb
      .update(events)
      .set({ entryGroupId: other.id })
      .where(eq(events.entryGroupId, entryGroupId))

    const result = await releaseExpiredBroadcasts(testDb, { today: '2026-08-02' })

    expect(result.releasedBroadcastIds).toContain(broadcastId)
    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('available')
    expect(channel?.assignedEntryGroupId).toBeNull()
  })

  it('r1: イベント0件でも extended_until が未来なら解放しない（明示延長を尊重）', async () => {
    const { broadcastId, entryGroupId } = await seedLinkedGroup(['2026-08-01'])
    const other = await createEntryGroup()
    await testDb
      .update(events)
      .set({ entryGroupId: other.id })
      .where(eq(events.entryGroupId, entryGroupId))
    await testDb
      .update(eventLineBroadcasts)
      .set({ extendedUntil: '2026-12-31' })
      .where(eq(eventLineBroadcasts.id, broadcastId))

    const result = await releaseExpiredBroadcasts(testDb, { today: '2026-08-02' })

    expect(result.releasedBroadcastIds).not.toContain(broadcastId)
  })

  it('extended_until が設定されていれば MAX(event_date) より優先される', async () => {
    const { broadcastId } = await seedLinkedGroup(['2026-08-01', '2026-09-20'])
    await testDb
      .update(eventLineBroadcasts)
      .set({ extendedUntil: '2026-12-31' })
      .where(eq(eventLineBroadcasts.id, broadcastId))

    // MAX(event_date)+30 = 2026-10-20 は過ぎているが、extended_until が優先。
    const result = await releaseExpiredBroadcasts(testDb, { today: '2026-11-01' })

    expect(result.releasedBroadcastIds).not.toContain(broadcastId)
    const row = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.id, broadcastId),
    })
    expect(row?.status).toBe('linked')
  })
})
