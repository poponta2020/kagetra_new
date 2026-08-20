import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup, createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import type { GroupCommonFieldsInput } from './actions'

/**
 * entry-group-page タスク2 (AC-19/AC-20): `saveGroupCommonFields` — グループ
 * 共通7項目の一括保存。
 */

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { saveGroupCommonFields } = await import('./actions')

const FULL_INPUT: GroupCommonFieldsInput = {
  entryDeadline: '2026-07-01',
  internalDeadline: '2026-06-20',
  lotteryDate: '2026-07-10',
  paymentDeadline: '2026-07-20',
  paymentDeadlineKind: 'fixed',
  paymentMethod: '北洋銀行',
  paymentInfo: '普通 1234567 北大かるた会',
  entryMethod: 'メール',
}

async function getEvent(id: number) {
  return testDb.query.events.findFirst({ where: eq(events.id, id) })
}

describe('saveGroupCommonFields', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('グループ内の全イベント（cancelled 含む）へ同一値が保存される（AC-19）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    const a = await createEvent({ title: '多摩A', entryGroupId: groupId })
    const b = await createEvent({
      title: '多摩B',
      entryGroupId: groupId,
      status: 'cancelled',
    })

    await saveGroupCommonFields(groupId, FULL_INPUT)

    for (const id of [a.id, b.id]) {
      const row = await getEvent(id)
      expect(row?.entryDeadline).toBe('2026-07-01')
      expect(row?.internalDeadline).toBe('2026-06-20')
      expect(row?.lotteryDate).toBe('2026-07-10')
      expect(row?.paymentDeadline).toBe('2026-07-20')
      expect(row?.paymentDeadlineKind).toBe('fixed')
      expect(row?.paymentMethod).toBe('北洋銀行')
      expect(row?.paymentInfo).toBe('普通 1234567 北大かるた会')
      expect(row?.entryMethod).toBe('メール')
    }
    // cancelled のままであることも固定（保存対象になったことで status が変わらない）。
    expect((await getEvent(b.id))?.status).toBe('cancelled')
  })

  it('非管理者は拒否される（member）', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })

    await expect(saveGroupCommonFields(groupId, FULL_INPUT)).rejects.toThrow('Forbidden')
    expect((await getEvent(event.id))?.entryDeadline).toBeNull()
  })

  it('未ログインは拒否される（Unauthorized）', async () => {
    await setAuthSession(null)
    const { id: groupId } = await createEntryGroup()

    await expect(saveGroupCommonFields(groupId, FULL_INPUT)).rejects.toThrow('Unauthorized')
  })

  describe('支払締切の日付と payment_deadline_kind の整合（AC-20）', () => {
    it('日付あり → kind は入力が later_notice でも fixed へ倒される', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { id: groupId } = await createEntryGroup()
      const event = await createEvent({ entryGroupId: groupId })

      await saveGroupCommonFields(groupId, {
        ...FULL_INPUT,
        paymentDeadline: '2026-08-01',
        paymentDeadlineKind: 'later_notice',
      })

      const row = await getEvent(event.id)
      expect(row?.paymentDeadline).toBe('2026-08-01')
      expect(row?.paymentDeadlineKind).toBe('fixed')
    })

    it('日付なし + later_notice → 日付 null・kind は later_notice のまま', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { id: groupId } = await createEntryGroup()
      const event = await createEvent({ entryGroupId: groupId })

      await saveGroupCommonFields(groupId, {
        ...FULL_INPUT,
        paymentDeadline: null,
        paymentDeadlineKind: 'later_notice',
      })

      const row = await getEvent(event.id)
      expect(row?.paymentDeadline).toBeNull()
      expect(row?.paymentDeadlineKind).toBe('later_notice')
    })

    it('日付なし + fixed → CHECK 違反を起こさず unspecified へ正規化される', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const { id: groupId } = await createEntryGroup()
      const event = await createEvent({ entryGroupId: groupId })

      await saveGroupCommonFields(groupId, {
        ...FULL_INPUT,
        paymentDeadline: null,
        paymentDeadlineKind: 'fixed',
      })

      const row = await getEvent(event.id)
      expect(row?.paymentDeadline).toBeNull()
      expect(row?.paymentDeadlineKind).toBe('unspecified')
    })
  })

  it('7項目以外を書き換えない（title/eventDate/entryStatus/paymentStatus/capacity は不変）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({
      title: '多摩A',
      eventDate: '2026-08-01',
      entryGroupId: groupId,
      capacity: 30,
    })

    await saveGroupCommonFields(groupId, FULL_INPUT)

    const row = await getEvent(event.id)
    expect(row?.title).toBe('多摩A')
    expect(row?.eventDate).toBe('2026-08-01')
    expect(row?.entryStatus).toBe('not_applied')
    expect(row?.paymentStatus).toBe('unpaid')
    expect(row?.capacity).toBe(30)
  })

  it('別グループのイベントは影響を受けない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()
    await createEvent({ entryGroupId: groupId })
    const other = await createEvent({ title: '別グループ' })

    await saveGroupCommonFields(groupId, FULL_INPUT)

    const row = await getEvent(other.id)
    expect(row?.entryDeadline).toBeNull()
    expect(row?.paymentMethod).toBeNull()
  })

  it('イベント0件のグループでも例外にならない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { id: groupId } = await createEntryGroup()

    await expect(saveGroupCommonFields(groupId, FULL_INPUT)).resolves.toBeUndefined()
  })
})
