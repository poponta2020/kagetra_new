import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  events,
  eventLifecycleNotifications,
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup, createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * entry-group-page タスク2 (AC-16/AC-17): `setEntriesNotApplying` の一括版と、
 * 薄いラッパーへ縮退した `setEntryNotApplying` の回帰。
 * `lifecycle-actions.test.ts` の `describe('setEntryNotApplying', ...)` は
 * 既存のまま（N=1 の遷移パターン網羅）なので、このファイルはバルク版だけを
 * 対象にする。
 */

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { setEntriesNotApplying, setEntryNotApplying } = await import('./actions')

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

/**
 * `actions.bulk-lifecycle.test.ts` の `seedLinkedChannel` と同じパターン。
 * linked なグループにしておかないと「通知が0件」が「claim すらしていない」の
 * 代わりに「claim はしたが push 先が無かっただけ」で偽陽性通過してしまう
 * （未紐付けでも claim は skipped 行を作る——bulk-lifecycle.test.ts 参照）。
 */
async function seedLinkedChannel(entryGroupId: number, lineGroupId = 'GnotApplying') {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: '@not-applying-bot',
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

describe('setEntriesNotApplying（一括版）', () => {
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

  it('同一グループの複数日が同一トランザクションで not_applying になる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { ids } = await seedMultiDayGroup()

    await setEntriesNotApplying(ids)

    for (const id of ids) {
      const row = await getEvent(id)
      expect(row?.entryStatus).toBe('not_applying')
      expect(row?.entryAppliedAt).toBeNull()
    }
  })

  it('通知は一切送られない（linked なグループでも claim・push が起きない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { ids, entryGroupId } = await seedMultiDayGroup()
    // linked にしておく — 未紐付けだと claim 自体は起きて skipped 行が積まれる
    // （bulk-lifecycle.test.ts）ため、それと区別できるようにする。
    await seedLinkedChannel(entryGroupId)

    delete process.env.LINE_NOTIFY_DRY_RUN
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      await setEntriesNotApplying(ids)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }

    expect(await notificationsFor(ids)).toHaveLength(0)
  })

  it('グループ外の id はフェイルクローズで除外される', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { ids } = await seedMultiDayGroup()
    const other = await createEvent({ title: '別グループ', eventDate: '2026-09-01' })

    await setEntriesNotApplying([...ids, other.id])

    for (const id of ids) {
      expect((await getEvent(id))?.entryStatus).toBe('not_applying')
    }
    expect((await getEvent(other.id))?.entryStatus).toBe('not_applied')
  })

  it('一般会員は拒否される（Forbidden）', async () => {
    const member = await createUser({ role: 'member' })
    const { ids } = await seedMultiDayGroup()
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(setEntriesNotApplying(ids)).rejects.toThrow('Forbidden')
    for (const id of ids) {
      expect((await getEvent(id))?.entryStatus).toBe('not_applied')
    }
  })

  it('未ログインは拒否される（Unauthorized）', async () => {
    const { ids } = await seedMultiDayGroup()
    await setAuthSession(null)

    await expect(setEntriesNotApplying(ids)).rejects.toThrow('Unauthorized')
  })

  it('空配列は no-op（例外を投げない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await expect(setEntriesNotApplying([])).resolves.toBeUndefined()
  })

  it('単一版 setEntryNotApplying(id) は従来どおり動く（薄いラッパー）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const event = await createEvent({ title: 'Solo' })

    await setEntryNotApplying(event.id)

    const row = await getEvent(event.id)
    expect(row?.entryStatus).toBe('not_applying')
    expect(row?.entryAppliedAt).toBeNull()
  })
})
