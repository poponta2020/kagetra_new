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
      status: 'skipped',
      sentCount: 0,
      totalCount: 0,
    }),
  ),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/line-broadcast-guidelines', () => ({
  sendGuidelinesOnLink: sendGuidelinesOnLinkMock,
}))

const { manualLinkGroup, releaseChannel } = await import('./actions')

const ADMIN = { id: 'admin-1', role: 'admin' as const }

afterAll(async () => {
  await closeTestDb()
})

async function seedAvailableChannel(token = 'tok-manual'): Promise<number> {
  const [ch] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: token,
      botId: '@kagetra-event-bot-test',
      purpose: 'event_broadcast',
      status: 'available',
    })
    .returning({ id: lineChannels.id })
  return ch!.id
}

describe('manualLinkGroup — 要綱送信 (broadcast-guidelines-on-link AC-7)', () => {
  beforeEach(async () => {
    await truncateAll()
    sendGuidelinesOnLinkMock.mockClear()
    sendGuidelinesOnLinkMock.mockResolvedValue({
      status: 'skipped',
      sentCount: 0,
      totalCount: 0,
    })
    await setAuthSession(ADMIN)
  })

  it('linked 確定後、確定した連携情報で要綱送信ヘルパーを呼ぶ', async () => {
    const ev = await createEvent({ title: '手動紐付け大会' })
    const channelId = await seedAvailableChannel('tok-manual')

    await manualLinkGroup({
      channelId,
      eventId: ev.id,
      lineGroupId: 'Cmanual123',
    })

    const broadcast = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, ev.entryGroupId),
    })
    expect(broadcast?.status).toBe('linked')

    expect(sendGuidelinesOnLinkMock).toHaveBeenCalledTimes(1)
    const guidelineCall = sendGuidelinesOnLinkMock.mock.calls[0] as
      | unknown[]
      | undefined
    expect(guidelineCall?.[0]).toBeDefined()
    expect(guidelineCall?.[1]).toMatchObject({
      eventLineBroadcastId: broadcast!.id,
      lineGroupId: 'Cmanual123',
      channelAccessToken: 'tok-manual',
    })
  })

  it('要綱送信が失敗（throw）しても linked は保たれ、ログに残す（best-effort・AC-6）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendGuidelinesOnLinkMock.mockRejectedValueOnce(new Error('boom'))
    const ev = await createEvent({ title: 'fail-safe' })
    const channelId = await seedAvailableChannel()

    // 送信が throw しても manualLinkGroup 自体は成功する。
    await manualLinkGroup({
      channelId,
      eventId: ev.id,
      lineGroupId: 'Cmanual456',
    })

    const broadcast = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, ev.entryGroupId),
    })
    expect(broadcast?.status).toBe('linked')

    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('active')

    // AC-6: 失敗はログに残る。
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('要綱送信が status=failed を返したら console.error に記録する（AC-6）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendGuidelinesOnLinkMock.mockResolvedValueOnce({
      status: 'failed',
      sentCount: 0,
      totalCount: 1,
    })
    const ev = await createEvent({ title: 'log-failed' })
    const channelId = await seedAvailableChannel()

    await manualLinkGroup({
      channelId,
      eventId: ev.id,
      lineGroupId: 'Cmanual789',
    })

    const broadcast = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, ev.entryGroupId),
    })
    expect(broadcast?.status).toBe('linked')
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('admin / vice_admin 以外は拒否する', async () => {
    const ev = await createEvent({ title: 'auth' })
    const channelId = await seedAvailableChannel()
    await setAuthSession({ id: 'm', role: 'member' })
    await expect(
      manualLinkGroup({ channelId, eventId: ev.id, lineGroupId: 'Cx' }),
    ).rejects.toThrow(/Forbidden/)
    expect(sendGuidelinesOnLinkMock).not.toHaveBeenCalled()
  })
})

/**
 * r2 review blocker: 強制解放の競合検出トークンは **entry_group_id**。
 * 以前は画面が見ていた代表イベント id で、イベント0件のグループ（付け替えで空に
 * なったが紐付けは残る）ではトークンが null に落ち、競合検出なしの broad release
 * に化けていた。
 */
describe('releaseChannel — 競合検出トークンは entry_group_id', () => {
  beforeEach(async () => {
    await truncateAll()
    await setAuthSession(ADMIN)
  })

  it('イベント0件のグループでも指定グループの紐付けだけを解除する', async () => {
    const group = await createEntryGroup()
    const channelId = await seedAvailableChannel('tok-empty')
    await testDb
      .update(lineChannels)
      .set({ status: 'active', assignedEntryGroupId: group.id })
      .where(eq(lineChannels.id, channelId))
    await testDb.insert(eventLineBroadcasts).values({
      entryGroupId: group.id,
      lineChannelId: channelId,
      status: 'linked',
      lineGroupId: 'Cempty',
      linkedAt: new Date(),
    })

    await releaseChannel(channelId, group.id)

    const broadcast = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, group.id),
    })
    expect(broadcast?.status).toBe('revoked')
    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('available')
    expect(channel?.assignedEntryGroupId).toBeNull()
  })

  it('stale なトークン（既に別グループへ再割当済み）では新しい紐付けを解除しない', async () => {
    const oldGroup = await createEntryGroup()
    const channelId = await seedAvailableChannel('tok-stale')
    // 旧グループの紐付けは既に revoked、チャネルは新グループへ再割当済み。
    await testDb.insert(eventLineBroadcasts).values({
      entryGroupId: oldGroup.id,
      lineChannelId: channelId,
      status: 'revoked',
      lineGroupId: 'Cold',
      revokedAt: new Date(),
    })
    const newEvent = await createEvent({ title: '新しい大会' })
    await testDb
      .update(lineChannels)
      .set({ status: 'active', assignedEntryGroupId: newEvent.entryGroupId })
      .where(eq(lineChannels.id, channelId))
    await testDb.insert(eventLineBroadcasts).values({
      entryGroupId: newEvent.entryGroupId,
      lineChannelId: channelId,
      status: 'linked',
      lineGroupId: 'Cnew',
      linkedAt: new Date(),
    })

    // 画面が見ていたのは旧グループ。no-op になるべき。
    await releaseChannel(channelId, oldGroup.id)

    const newBinding = await testDb.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, newEvent.entryGroupId),
    })
    expect(newBinding?.status).toBe('linked')
    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('active')
    expect(channel?.assignedEntryGroupId).toBe(newEvent.entryGroupId)
  })
})
