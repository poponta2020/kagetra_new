import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroupTravelSettings,
  travelReportBatches,
  travelReportDocuments,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * travel-report タスク7: 作成 Action（AC-20・AC-21・AC-28）。
 * ★通知が失敗しても作成物は保存済みのまま `notify_error` に理由が残る。
 */

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const sendTravelReportCreatedNotice = vi.fn()
vi.mock('@/lib/travel-report/notify', () => ({
  sendTravelReportCreatedNotice: (...args: unknown[]) => sendTravelReportCreatedNotice(...args),
}))

const { createTravelReportsAction } = await import('./actions')

afterAll(async () => {
  await closeTestDb()
})

const DATES = ['2026-11-07', '2026-11-08']

async function seedGroup() {
  const group = await createEntryGroup()
  const eventIds: number[] = []
  for (const date of DATES) {
    const ev = await createEvent({
      entryGroupId: group.id,
      eventDate: date,
      title: '帯広新人戦',
      location: '帯広市総合体育館',
      eligibleGrades: ['A'],
    })
    eventIds.push(ev.id)
  }
  const member = await createUser({
    isCircleMember: true,
    familyName: '北海',
    givenName: '太郎',
    faculty: '法学部',
    schoolYear: '4年',
    phone: '090-0000-0001',
  })
  for (const id of eventIds) {
    await createEventAttendance({ eventId: id, userId: member.id, attend: true })
  }
  return { group, eventIds, member }
}

const file = (dates: string[] = DATES) => ({
  dates,
  purpose: '第20回 帯広かるた新人戦(A級)への参加',
  place: '帯広市総合体育館',
  destinationContacts: [{ name: '北海太郎', phone: '090-0000-0001' }],
  homeContact: null,
  reportDate: '2026-09-06',
  approvalDate: null,
})

describe('createTravelReportsAction', () => {
  beforeEach(async () => {
    await truncateAll()
    sendTravelReportCreatedNotice.mockReset()
    sendTravelReportCreatedNotice.mockResolvedValue({ outcome: 'sent' })
  })

  it('提出権限者が作成でき、通知成功で notified_at が入る', async () => {
    const { group } = await seedGroup()
    const submitter = await createUser({ isTravelReportSubmitter: true })
    await setAuthSession({ id: submitter.id, role: 'member' })

    const result = await createTravelReportsAction(group.id, [file()])
    expect(result).toMatchObject({ ok: true, fileCount: 1 })

    const [batch] = await testDb
      .select()
      .from(travelReportBatches)
      .where(eq(travelReportBatches.entryGroupId, group.id))
    expect(batch?.notifiedAt).not.toBeNull()
    expect(batch?.notifyError).toBeNull()
    expect(sendTravelReportCreatedNotice).toHaveBeenCalledTimes(1)
  })

  it('★通知が失敗しても作成物は保存済みで、notify_error に理由が残る（AC-28）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    sendTravelReportCreatedNotice.mockResolvedValue({ outcome: 'failed', error: 'LINE がエラー' })

    const result = await createTravelReportsAction(group.id, [file()])
    expect(result.ok).toBe(true)
    expect(result.notifyError).toBe('LINE がエラー')

    const [batch] = await testDb
      .select()
      .from(travelReportBatches)
      .where(eq(travelReportBatches.entryGroupId, group.id))
    expect(batch?.notifiedAt).toBeNull()
    expect(batch?.notifyError).toBe('LINE がエラー')
    const docs = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.batchId, batch!.id))
    expect(docs).toHaveLength(1)
  })

  it('LINE 未紐付け（skipped_unlinked）は失敗として記録しない', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    sendTravelReportCreatedNotice.mockResolvedValue({ outcome: 'skipped_unlinked' })

    const result = await createTravelReportsAction(group.id, [file()])
    expect(result.ok).toBe(true)
    expect(result.notifyError).toBeUndefined()
    const [batch] = await testDb
      .select()
      .from(travelReportBatches)
      .where(eq(travelReportBatches.entryGroupId, group.id))
    expect(batch?.notifiedAt).toBeNull()
    expect(batch?.notifyError).toBeNull()
  })

  it('提出権限者でなければ拒否され、何も保存されない（AC-21）', async () => {
    const { group } = await seedGroup()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    expect(await createTravelReportsAction(group.id, [file()])).toMatchObject({ ok: false })

    const guest = await createGuest({ isTravelReportSubmitter: true })
    await setAuthSession({ id: guest.id, role: 'guest' })
    expect(await createTravelReportsAction(group.id, [file()])).toMatchObject({ ok: false })

    await setAuthSession(null)
    expect(await createTravelReportsAction(group.id, [file()])).toMatchObject({ ok: false })

    expect(await testDb.select().from(travelReportBatches)).toHaveLength(0)
    expect(sendTravelReportCreatedNotice).not.toHaveBeenCalled()
  })

  it('同じ日が複数のファイルに入っていたら拒否する', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const result = await createTravelReportsAction(group.id, [
      file([DATES[0]!]),
      file([DATES[0]!, DATES[1]!]),
    ])
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toContain('同じ日が複数のファイル')
    expect(await testDb.select().from(travelReportBatches)).toHaveLength(0)
  })

  it('ファイルが0件・日付の形式が不正なら拒否する', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    expect(await createTravelReportsAction(group.id, [])).toMatchObject({ ok: false })
    expect(
      await createTravelReportsAction(group.id, [file(['2026/11/07'])]),
    ).toMatchObject({ ok: false })
  })

  it('分割どおりのファイル数が生成される（AC-20）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const result = await createTravelReportsAction(group.id, [
      file([DATES[0]!]),
      file([DATES[1]!]),
    ])
    expect(result).toMatchObject({ ok: true, fileCount: 2 })
  })

  it('グループの開催日に無い日付を送ると拒否される（Codex R1 #7: 未知の日）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const result = await createTravelReportsAction(group.id, [file(['2026-11-09'])])
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toContain('開催日')
    expect(await testDb.select().from(travelReportBatches)).toHaveLength(0)
  })

  it('cancelled の日を含めると拒否される（Codex R1 #7）', async () => {
    const { group } = await seedGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2026-11-20', status: 'cancelled' })
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const result = await createTravelReportsAction(group.id, [
      file([...DATES, '2026-11-20']),
    ])
    expect(result).toMatchObject({ ok: false })
    expect(await testDb.select().from(travelReportBatches)).toHaveLength(0)
  })

  it('一部の開催日が欠けていると拒否される（Codex R1 #7）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const result = await createTravelReportsAction(group.id, [file([DATES[0]!])])
    expect(result).toMatchObject({ ok: false })
    expect(await testDb.select().from(travelReportBatches)).toHaveLength(0)
  })

  it('実在しない日付（2026-02-31 等）は形式が合っていても拒否される（Codex R1 #3）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const result = await createTravelReportsAction(group.id, [file(['2026-02-31'])])
    expect(result).toMatchObject({ ok: false })
  })

  it('「不要」に設定したグループでは作成できない（AC-10・Codex R1 #8）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await testDb
      .insert(entryGroupTravelSettings)
      .values({ entryGroupId: group.id, required: false })

    const result = await createTravelReportsAction(group.id, [file()])
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toContain('不要')
    expect(await testDb.select().from(travelReportBatches)).toHaveLength(0)
  })

  it('通知関数が例外を投げても作成は成功として扱われ、notify_error に理由が残る（Codex R1 #9）', async () => {
    const { group } = await seedGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    sendTravelReportCreatedNotice.mockRejectedValue(new Error('LINE API がタイムアウトしました'))

    const result = await createTravelReportsAction(group.id, [file()])
    expect(result.ok).toBe(true)
    expect(result.notifyError).toContain('タイムアウト')

    const [batch] = await testDb
      .select()
      .from(travelReportBatches)
      .where(eq(travelReportBatches.entryGroupId, group.id))
    expect(batch?.notifyError).toContain('タイムアウト')
    const docs = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.batchId, batch!.id))
    expect(docs).toHaveLength(1)
  })
})
