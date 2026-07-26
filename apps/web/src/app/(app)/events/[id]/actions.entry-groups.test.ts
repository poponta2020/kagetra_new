import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { eventLineBroadcasts, lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

type GuidelineResult = {
  status: 'skipped' | 'sent' | 'partial' | 'failed'
  reason?: string
  sentCount: number
  totalCount: number
}

const { sendGuidelinesOnLinkMock } = vi.hoisted(() => ({
  sendGuidelinesOnLinkMock: vi.fn(
    async (): Promise<GuidelineResult> => ({
      status: 'sent',
      sentCount: 1,
      totalCount: 1,
    }),
  ),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// 実 push はテスト対象外。resendGuidelines がヘルパーを呼ぶ配線だけ検証する。
vi.mock('@/lib/line-broadcast-guidelines', () => ({
  sendGuidelinesOnLink: sendGuidelinesOnLinkMock,
}))

const { generateInviteCodeForEvent, revokeBroadcast, extendBroadcastLifetime, resendGuidelines } =
  await import('./actions')

const ADMIN = { id: 'admin-1', role: 'admin' as const }

afterAll(async () => {
  await closeTestDb()
})

async function seedAvailableChannel(): Promise<number> {
  const [ch] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: '@kagetra-event-bot-test',
      purpose: 'event_broadcast',
      status: 'available',
    })
    .returning({ id: lineChannels.id })
  return ch!.id
}

/** 同一グループの2日分イベントを作る（entry-groups: 多摩A/B のような構図）。 */
async function seedMultiDayGroup(): Promise<{ day1: number; day2: number; entryGroupId: number }> {
  const { id: entryGroupId } = await createEntryGroup()
  const day1 = await createEvent({ title: 'グループA', eventDate: '2031-01-11', entryGroupId })
  const day2 = await createEvent({ title: 'グループB', eventDate: '2031-01-12', entryGroupId })
  return { day1: day1.id, day2: day2.id, entryGroupId }
}

async function activeBroadcastRow(entryGroupId: number) {
  return testDb.query.eventLineBroadcasts.findFirst({
    where: eq(eventLineBroadcasts.entryGroupId, entryGroupId),
  })
}

describe('entry-groups タスク3 — LINE 紐付け・配信のグループ化', () => {
  beforeEach(async () => {
    await truncateAll()
    sendGuidelinesOnLinkMock.mockClear()
    await setAuthSession(ADMIN)
  })

  describe('AC-4: グループ内のどの日から操作しても同一の紐付けに作用する', () => {
    it('day1 で発行したコードを day2 の revokeBroadcast で解除できる（同一行に作用）', async () => {
      const { day1, day2, entryGroupId } = await seedMultiDayGroup()
      await seedAvailableChannel()

      await generateInviteCodeForEvent(day1)
      const before = await activeBroadcastRow(entryGroupId)
      expect(before?.status).toBe('invite_pending')
      const issuedBroadcastId = before!.id

      // day2（別の日）から解除しても、day1 で発行した同一行が revoked になる。
      await revokeBroadcast(day2)

      const after = await activeBroadcastRow(entryGroupId)
      expect(after?.status).toBe('revoked')
      expect(after?.id).toBe(issuedBroadcastId) // 新しい行が増えず同一行が更新される
      const revokedRow = await testDb.query.eventLineBroadcasts.findFirst({
        where: eq(eventLineBroadcasts.id, issuedBroadcastId),
      })
      expect(revokedRow?.status).toBe('revoked')
      expect(revokedRow?.id).toBe(issuedBroadcastId)
    })

    it('day2 で発行したコードを day1 の extendBroadcastLifetime で延長できる（同一行に作用）', async () => {
      const { day1, day2, entryGroupId } = await seedMultiDayGroup()
      await seedAvailableChannel()

      await generateInviteCodeForEvent(day2)
      const issuedBroadcastId = (await activeBroadcastRow(entryGroupId))!.id

      // day1（発行に使っていない別の日）から延長操作を行う。
      await extendBroadcastLifetime(day1, '2031-12-31')

      const row = await activeBroadcastRow(entryGroupId)
      expect(row?.id).toBe(issuedBroadcastId)
      expect(row?.extendedUntil).toBe('2031-12-31')
    })

    it('day1 の紐付けを day2 の resendGuidelines から再送できる（同一行に作用）', async () => {
      const { day1, day2, entryGroupId } = await seedMultiDayGroup()
      const channelId = await seedAvailableChannel()
      await testDb.insert(eventLineBroadcasts).values({
        entryGroupId,
        lineChannelId: channelId,
        status: 'linked',
        lineGroupId: 'Cmultiday',
        linkedAt: new Date(),
      })

      await resendGuidelines(day2)

      expect(sendGuidelinesOnLinkMock).toHaveBeenCalledTimes(1)
      expect(sendGuidelinesOnLinkMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lineGroupId: 'Cmultiday' }),
      )

      // day1（発行に使っていない別の日）からも同じ紐付け行に作用する
      // ことを確認する — 呼び出し回数が積み上がる（同一行を指している証拠）。
      await resendGuidelines(day1)
      expect(sendGuidelinesOnLinkMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('AC-5: 1グループにつき有効な LINE 紐付けは最大1件（行再利用）', () => {
    it('同一グループへ2回発行しても行は増えず、同一行が UPDATE される', async () => {
      const { day1, entryGroupId } = await seedMultiDayGroup()
      // 再発行時に別チャネルへ流れても枯渇しないよう2つ用意。
      await seedAvailableChannel()
      await seedAvailableChannel()

      const first = await generateInviteCodeForEvent(day1)
      const firstRowId = (await activeBroadcastRow(entryGroupId))!.id

      const second = await generateInviteCodeForEvent(day1)
      const secondRowId = (await activeBroadcastRow(entryGroupId))!.id

      const rows = await testDb
        .select({ id: eventLineBroadcasts.id })
        .from(eventLineBroadcasts)
        .where(eq(eventLineBroadcasts.entryGroupId, entryGroupId))
      expect(rows).toHaveLength(1)
      expect(secondRowId).toBe(firstRowId)
      // 再発行でコードが差し替わる（同一行 UPDATE の副作用）。
      expect(second.inviteCode).not.toBe(first.inviteCode)
      // 状態遷移は invite_pending のまま（再発行はコード差し替えのみ）。
      const row = await activeBroadcastRow(entryGroupId)
      expect(row?.status).toBe('invite_pending')
    })
  })
})
