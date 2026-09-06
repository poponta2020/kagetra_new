import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  entryGroupSelectionStatuses,
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createEventAttendance, createGuest, createUser } from '@/test-utils/seed'
import {
  deriveEffectiveSelection,
  getEffectiveSelectionStatuses,
  loadSelectionStatusRows,
  type RosterOutcomeInput,
} from './selection-status'

// travel-report タスク3 (AC-8/AC-9): 有効な確定状況の導出・読み出し。

describe('deriveEffectiveSelection', () => {
  it('手入力があれば名簿の内容に関わらずそれを返す', () => {
    const rosterRow: RosterOutcomeInput = { status: 'cancelled', selectionOutcome: 'rejected' }
    expect(deriveEffectiveSelection('confirmed', rosterRow)).toBe('confirmed')
    expect(deriveEffectiveSelection('waitlisted', null)).toBe('waitlisted')
    expect(deriveEffectiveSelection('not_participating', rosterRow)).toBe('not_participating')
  })

  it('手入力が無く名簿行も無ければ「確定」', () => {
    expect(deriveEffectiveSelection(null, null)).toBe('confirmed')
  })

  it('selectionOutcome=waitlisted は status に関わらずキャンセル待ち', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'confirmed', selectionOutcome: 'waitlisted' }),
    ).toBe('waitlisted')
    expect(
      deriveEffectiveSelection(null, { status: 'applied', selectionOutcome: 'waitlisted' }),
    ).toBe('waitlisted')
  })

  it('selectionOutcome=rejected は不参加', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'confirmed', selectionOutcome: 'rejected' }),
    ).toBe('not_participating')
  })

  it('status=cancelled は selectionOutcome に関わらず不参加', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'cancelled', selectionOutcome: 'accepted' }),
    ).toBe('not_participating')
  })

  it('status=carry_up_declined は不参加', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'carry_up_declined', selectionOutcome: 'unknown' }),
    ).toBe('not_participating')
  })

  it('status=confirmed かつ waitlisted/rejected でなければ確定', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'confirmed', selectionOutcome: 'accepted' }),
    ).toBe('confirmed')
  })

  it('status=carried_up（繰上）は確定', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'carried_up', selectionOutcome: 'unknown' }),
    ).toBe('confirmed')
  })

  it('status=applied（それ以外）は確定にフォールバックする', () => {
    expect(
      deriveEffectiveSelection(null, { status: 'applied', selectionOutcome: 'accepted' }),
    ).toBe('confirmed')
    expect(
      deriveEffectiveSelection(null, { status: 'applied', selectionOutcome: 'unknown' }),
    ).toBe('confirmed')
  })
})

describe('getEffectiveSelectionStatuses / loadSelectionStatusRows', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  async function seedConfirmedRoster(
    entryGroupId: number,
    entries: { userId: string; status: RosterOutcomeInput['status']; outcome: RosterOutcomeInput['selectionOutcome'] }[],
    version = 1,
  ) {
    const [roster] = await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId, rosterType: 'confirmed', version })
      .returning()
    if (!roster) throw new Error('failed to create roster')
    await testDb.insert(tournamentEntryRosterEntries).values(
      entries.map((e, i) => ({
        rosterId: roster.id,
        rawName: `name-${i}`,
        userId: e.userId,
        status: e.status,
        selectionOutcome: e.outcome,
        seqNo: i + 1,
      })),
    )
    return roster
  }

  it('名簿にも手入力にも無いユーザーは Map に現れない（疎な Map。呼び出し側の既定=確定）', async () => {
    const { id: groupId } = await createEntryGroup()
    const map = await getEffectiveSelectionStatuses(groupId)
    expect(map.size).toBe(0)
  })

  it('取込確定名簿から導出する（手入力なし）', async () => {
    const { id: groupId } = await createEntryGroup()
    const confirmed = await createUser({ grade: 'A' })
    const waitlisted = await createUser({ grade: 'B' })
    const rejected = await createUser({ grade: 'C' })
    await seedConfirmedRoster(groupId, [
      { userId: confirmed.id, status: 'confirmed', outcome: 'accepted' },
      { userId: waitlisted.id, status: 'applied', outcome: 'waitlisted' },
      { userId: rejected.id, status: 'applied', outcome: 'rejected' },
    ])

    const map = await getEffectiveSelectionStatuses(groupId)
    expect(map.get(confirmed.id)).toBe('confirmed')
    expect(map.get(waitlisted.id)).toBe('waitlisted')
    expect(map.get(rejected.id)).toBe('not_participating')
  })

  it('手入力が取込名簿より優先される（AC-8: 初期表示の導出順）', async () => {
    const { id: groupId } = await createEntryGroup()
    const user = await createUser({ grade: 'A' })
    await seedConfirmedRoster(groupId, [
      { userId: user.id, status: 'applied', outcome: 'waitlisted' },
    ])
    const admin = await createUser({ role: 'admin' })
    await testDb.insert(entryGroupSelectionStatuses).values({
      entryGroupId: groupId,
      userId: user.id,
      status: 'confirmed',
      updatedBy: admin.id,
    })

    const map = await getEffectiveSelectionStatuses(groupId)
    expect(map.get(user.id)).toBe('confirmed')
  })

  it('有効な確定名簿（superseded_at IS NULL）が複数版あっても version 最大の版だけを使う（Codex R1 #1）', async () => {
    const { id: groupId } = await createEntryGroup()
    const onlyInOldVersion = await createUser({ grade: 'A' })
    const inBothVersions = await createUser({ grade: 'B' })
    // 旧版（version=1）: 本来は再取込時に superseded_at が入るはずだが、事故で
    // NULL のまま残ったケースを再現する。
    await seedConfirmedRoster(
      groupId,
      [
        { userId: onlyInOldVersion.id, status: 'confirmed', outcome: 'accepted' },
        { userId: inBothVersions.id, status: 'applied', outcome: 'waitlisted' },
      ],
      1,
    )
    // 新版（version=2）: こちらが実質最新。
    await seedConfirmedRoster(
      groupId,
      [{ userId: inBothVersions.id, status: 'confirmed', outcome: 'accepted' }],
      2,
    )

    const map = await getEffectiveSelectionStatuses(groupId)
    // 旧版にしか居ないユーザーは Map に現れない（最新版だけを見るため）。
    expect(map.has(onlyInOldVersion.id)).toBe(false)
    // 両版に居るユーザーは新版（confirmed/accepted）の結果になる。
    expect(map.get(inBothVersions.id)).toBe('confirmed')
  })

  it('loadSelectionStatusRows: 出欠「参加」の会員・ゲストを対象に含み、退会済みは除く（AC-8）', async () => {
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const member = await createUser({ grade: 'A', name: '北海 太郎' })
    const guest = await createGuest({ grade: 'B', name: '函館 大地' })
    const notParticipating = await createUser({ grade: 'C' })
    const deactivated = await createUser({ grade: 'D', deactivatedAt: new Date() })

    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: notParticipating.id, attend: false })
    await createEventAttendance({ eventId: event.id, userId: deactivated.id, attend: true })

    const rows = await loadSelectionStatusRows(groupId)
    const userIds = rows.map((r) => r.userId).sort()
    expect(userIds).toEqual([guest.id, member.id].sort())

    const guestRow = rows.find((r) => r.userId === guest.id)
    expect(guestRow?.isGuest).toBe(true)
    expect(guestRow?.status).toBe('confirmed') // 名簿行が無ければ確定（既定）

    const memberRow = rows.find((r) => r.userId === member.id)
    expect(memberRow?.isGuest).toBe(false)
    expect(memberRow?.grade).toBe('A')
  })

  it('loadSelectionStatusRows: 名簿由来のキャンセル待ち・不参加が反映される', async () => {
    const { id: groupId } = await createEntryGroup()
    const event = await createEvent({ entryGroupId: groupId })
    const waitlisted = await createUser({ grade: 'B' })
    await createEventAttendance({ eventId: event.id, userId: waitlisted.id, attend: true })
    await seedConfirmedRoster(groupId, [
      { userId: waitlisted.id, status: 'applied', outcome: 'waitlisted' },
    ])

    const rows = await loadSelectionStatusRows(groupId)
    expect(rows.find((r) => r.userId === waitlisted.id)?.status).toBe('waitlisted')
  })

  it('イベントが1件も無いグループでは空配列を返す', async () => {
    const { id: groupId } = await createEntryGroup()
    const rows = await loadSelectionStatusRows(groupId)
    expect(rows).toEqual([])
  })
})
