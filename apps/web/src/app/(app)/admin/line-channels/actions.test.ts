import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { eventLineBroadcasts, lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent } from '@/test-utils/seed'
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

const { manualLinkGroup } = await import('./actions')

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
      where: eq(eventLineBroadcasts.eventId, ev.id),
    })
    expect(broadcast?.status).toBe('linked')

    expect(sendGuidelinesOnLinkMock).toHaveBeenCalledTimes(1)
    expect(sendGuidelinesOnLinkMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventLineBroadcastId: broadcast!.id,
        lineGroupId: 'Cmanual123',
        channelAccessToken: 'tok-manual',
      }),
    )
  })

  it('要綱送信が失敗（throw）しても linked は保たれる（best-effort）', async () => {
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
      where: eq(eventLineBroadcasts.eventId, ev.id),
    })
    expect(broadcast?.status).toBe('linked')

    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.status).toBe('active')
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
