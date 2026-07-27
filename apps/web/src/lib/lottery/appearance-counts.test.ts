import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  events,
  players,
  tournamentClasses,
  tournamentConfirmedRosterPublications,
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
  tournamentParticipants,
  tournaments,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser, createEntryGroup } from '@/test-utils/seed'
import {
  APPEARANCE_COUNT_RULE_VERSION,
  buildAppearanceCountsQuery,
  getAppearanceCounts,
  getAssociationYearRange,
} from './appearance-counts'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
type EntryStatus = 'applied' | 'confirmed' | 'carried_up' | 'carry_up_declined' | 'cancelled'
type SelectionOutcome = 'accepted' | 'waitlisted' | 'rejected' | 'unknown'

async function createPlayer(name: string, userId: string | null = null) {
  const [player] = await testDb
    .insert(players)
    .values({ displayName: name, normalizedName: name, userId })
    .returning()
  if (!player) throw new Error('failed to create player')
  return player
}

async function createEdition(input: {
  editionNumber: number
  eventDate: string
  category?: 'official' | 'new_year' | 'hosted' | 'supported' | 'other' | 'unknown'
  status?: 'held' | 'cancelled' | 'unconfirmed'
  eligibleGrades: Grade[]
}) {
  let [series] = await testDb.select().from(tournamentSeries).limit(1)
  if (!series) {
    ;[series] = await testDb
      .insert(tournamentSeries)
      .values({ name: `appearance-series-${crypto.randomUUID()}` })
      .returning()
  }
  const [edition] = await testDb
    .insert(tournamentSeriesEditions)
    .values({
      seriesId: series!.id,
      editionNumber: input.editionNumber,
      year: Number(input.eventDate.slice(0, 4)),
      status: input.status ?? 'held',
      competitionCategory: input.category ?? 'official',
    })
    .returning()
  if (!edition) throw new Error('failed to create edition')
  const [event] = await testDb
    .insert(events)
    .values({
      entryGroupId: (await createEntryGroup()).id,
      title: `edition-${input.editionNumber}`,
      eventDate: input.eventDate,
      editionId: edition.id,
      eligibleGrades: input.eligibleGrades,
    })
    .returning()
  if (!event) throw new Error('failed to create event')
  return { edition, event }
}

async function publishRoster(
  editionId: number,
  entryGroupId: number,
  grade: Grade,
  publishedAt: string,
  entries: Array<{
    playerId: number
    userId?: string | null
    status?: EntryStatus
    outcome?: SelectionOutcome
  }>,
  version = 1,
) {
  const [roster] = await testDb
    .insert(tournamentEntryRosters)
    .values({ entryGroupId, rosterType: 'confirmed', version, publishedAt })
    .returning()
  if (!roster) throw new Error('failed to create roster')
  if (entries.length > 0) {
    await testDb.insert(tournamentEntryRosterEntries).values(
      entries.map((entry, index) => ({
        rosterId: roster.id,
        playerId: entry.playerId,
        userId: entry.userId ?? null,
        grade,
        rawName: `player-${entry.playerId}`,
        status: entry.status ?? 'confirmed',
        selectionOutcome: entry.outcome ?? 'accepted',
        seqNo: index + 1,
      })),
    )
  }
  await testDb.insert(tournamentConfirmedRosterPublications).values({
    editionId,
    grade,
    rosterId: roster.id,
    publishedAt,
  })
  return roster
}

async function createActualResult(
  editionId: number,
  grade: Grade,
  eventDate: string,
  playerIds: number[],
) {
  const [tournament] = await testDb
    .insert(tournaments)
    .values({ name: `result-${editionId}-${grade}-${crypto.randomUUID()}`, editionId, eventDate })
    .returning()
  const [tournamentClass] = await testDb
    .insert(tournamentClasses)
    .values({ tournamentId: tournament!.id, className: `${grade}級`, grade })
    .returning()
  if (!tournamentClass) throw new Error('failed to create result class')
  if (playerIds.length > 0) {
    await testDb.insert(tournamentParticipants).values(
      playerIds.map((playerId, index) => ({
        classId: tournamentClass.id,
        playerId,
        name: `player-${playerId}`,
        seqNo: index + 1,
      })),
    )
  }
  return tournamentClass
}

async function addActiveFact(
  editionId: number,
  grade: Grade,
  actualResultClassId: number | null,
  overrides: { validTo?: Date | null } = {},
) {
  const [fact] = await testDb
    .insert(tournamentEditionGradeLotteryFacts)
    .values({
      editionId,
      grade,
      selectionStatus: 'unknown',
      actualResultClassId,
      selectionRuleVersion: APPEARANCE_COUNT_RULE_VERSION,
      validTo: overrides.validTo ?? null,
    })
    .returning()
  if (!fact) throw new Error('failed to create fact')
  return fact
}

describe('association year helper', () => {
  it('uses the Asia/Tokyo association year from April 1 through March 31', () => {
    expect(getAssociationYearRange(2024)).toEqual({
      startDate: '2024-04-01',
      endDate: '2025-03-31',
    })
  })
})

describe('getAppearanceCounts', () => {
  beforeEach(truncateAll)
  afterAll(closeTestDb)

  it('counts only official/new-year editions inside the Apr-Mar year, including B-E history', async () => {
    const player = await createPlayer('年度境界選手')
    const cases = [
      { date: '2024-03-31', category: 'official' as const, grade: 'A' as const, count: false },
      { date: '2024-04-01', category: 'official' as const, grade: 'B' as const, count: true },
      { date: '2024-08-01', category: 'hosted' as const, grade: 'C' as const, count: false },
      { date: '2025-03-31', category: 'new_year' as const, grade: 'E' as const, count: true },
      { date: '2025-04-01', category: 'official' as const, grade: 'D' as const, count: false },
    ]
    for (const [index, item] of cases.entries()) {
      const { edition, event } = await createEdition({
        editionNumber: index + 1,
        eventDate: item.date,
        category: item.category,
        eligibleGrades: [item.grade],
      })
      await publishRoster(edition.id, event.entryGroupId, item.grade, item.date, [
        { playerId: player.id },
      ])
      const resultClass = await createActualResult(edition.id, item.grade, item.date, [player.id])
      await addActiveFact(edition.id, item.grade, resultClass.id)
    }

    const result = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2025-03-31' },
      testDb,
    )

    expect(result.playerCounts).toEqual([{ playerId: player.id, count: 2 }])
    expect(result.memberCounts).toEqual([])
    expect(result.completeness).toBe('complete')
    expect(result.missing).toEqual([])
    expect(result.ruleVersion).toBe(APPEARANCE_COUNT_RULE_VERSION)
  })

  it('unions eligible confirmed publications and active facts, DISTINCT per edition/player', async () => {
    const confirmed = await createPlayer('確定選手')
    const cancelled = await createPlayer('確定後取消選手')
    const carriedUp = await createPlayer('繰上選手')
    const declined = await createPlayer('辞退選手')
    const waitlisted = await createPlayer('キャンセル待ち選手')
    const actualOnly = await createPlayer('当日繰上選手')
    const rejected = await createPlayer('落選選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-08-01',
      eligibleGrades: ['B', 'E'],
    })

    await publishRoster(
      edition.id,
      event.entryGroupId,
      'B',
      '2024-07-01',
      [
        { playerId: confirmed.id, status: 'confirmed' },
        { playerId: declined.id, status: 'carry_up_declined', outcome: 'waitlisted' },
        { playerId: waitlisted.id, status: 'confirmed', outcome: 'waitlisted' },
        { playerId: rejected.id, status: 'confirmed', outcome: 'rejected' },
      ],
      1,
    )
    await publishRoster(
      edition.id,
      event.entryGroupId,
      'E',
      '2024-07-15',
      [
        { playerId: cancelled.id, status: 'cancelled' },
        { playerId: carriedUp.id, status: 'carried_up', outcome: 'waitlisted' },
        { playerId: confirmed.id, status: 'confirmed' },
      ],
      2,
    )
    const resultClass = await createActualResult(edition.id, 'B', '2024-08-01', [
      confirmed.id,
      actualOnly.id,
    ])
    await addActiveFact(edition.id, 'B', resultClass.id)
    const eResultClass = await createActualResult(edition.id, 'E', '2024-08-01', [confirmed.id])
    await addActiveFact(edition.id, 'E', eResultClass.id)

    const result = await getAppearanceCounts(
      {
        playerIds: [
          confirmed.id,
          cancelled.id,
          carriedUp.id,
          declined.id,
          waitlisted.id,
          actualOnly.id,
          rejected.id,
        ],
        associationYear: 2024,
        referenceDate: '2025-03-31',
      },
      testDb,
    )

    expect(result.playerCounts).toEqual([
      { playerId: confirmed.id, count: 1 },
      { playerId: cancelled.id, count: 1 },
      { playerId: carriedUp.id, count: 1 },
      { playerId: declined.id, count: 0 },
      { playerId: waitlisted.id, count: 0 },
      { playerId: actualOnly.id, count: 1 },
      { playerId: rejected.id, count: 0 },
    ])
    expect(result.completeness).toBe('complete')
  })

  it('applies the reference-date cutoff to publications and actual results', async () => {
    const player = await createPlayer('基準日選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-06-01',
      status: 'unconfirmed',
      eligibleGrades: ['A'],
    })
    await publishRoster(edition.id, event.entryGroupId, 'A', '2024-06-02', [{ playerId: player.id }])
    const resultClass = await createActualResult(edition.id, 'A', '2024-06-03', [player.id])
    await addActiveFact(edition.id, 'A', resultClass.id)

    const beforePublication = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2024-06-01' },
      testDb,
    )
    const afterPublication = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2024-06-02' },
      testDb,
    )
    const afterResult = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2024-06-03' },
      testDb,
    )

    expect(beforePublication.playerCounts[0]?.count).toBe(0)
    expect(afterPublication.playerCounts[0]?.count).toBe(1)
    expect(afterResult.playerCounts[0]?.count).toBe(1)
  })

  it('counts a confirmed publication before the cutoff even when the edition is held later', async () => {
    const rosterPlayer = await createPlayer('将来開催確定選手')
    const actualOnlyPlayer = await createPlayer('将来結果選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-12-01',
      status: 'unconfirmed',
      eligibleGrades: ['A'],
    })
    await publishRoster(edition.id, event.entryGroupId, 'A', '2024-05-20', [
      { playerId: rosterPlayer.id },
    ])
    const futureResult = await createActualResult(edition.id, 'A', '2024-12-01', [
      actualOnlyPlayer.id,
    ])
    await addActiveFact(edition.id, 'A', futureResult.id)

    const result = await getAppearanceCounts(
      {
        playerIds: [rosterPlayer.id, actualOnlyPlayer.id],
        associationYear: 2024,
        referenceDate: '2024-06-01',
      },
      testDb,
    )

    expect(result.playerCounts).toEqual([
      { playerId: rosterPlayer.id, count: 1 },
      { playerId: actualOnlyPlayer.id, count: 0 },
    ])
    expect(result.completeness).toBe('complete')
  })

  it('follows the active fact when a corrected result replaces the old class', async () => {
    const oldPlayer = await createPlayer('旧結果選手')
    const correctedPlayer = await createPlayer('訂正結果選手')
    const { edition } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-09-01',
      eligibleGrades: ['A'],
    })
    const oldClass = await createActualResult(edition.id, 'A', '2024-09-01', [oldPlayer.id])
    await addActiveFact(edition.id, 'A', oldClass.id, { validTo: new Date('2024-09-02T00:00:00Z') })
    const correctedClass = await createActualResult(edition.id, 'A', '2024-09-01', [
      correctedPlayer.id,
    ])
    await addActiveFact(edition.id, 'A', correctedClass.id)

    const result = await getAppearanceCounts(
      {
        playerIds: [oldPlayer.id, correctedPlayer.id],
        associationYear: 2024,
        referenceDate: '2025-03-31',
      },
      testDb,
    )

    expect(result.playerCounts).toEqual([
      { playerId: oldPlayer.id, count: 0 },
      { playerId: correctedPlayer.id, count: 1 },
    ])
  })

  it('uses only non-superseded rosters when a confirmed publication is corrected', async () => {
    const oldPlayer = await createPlayer('旧名簿選手')
    const correctedPlayer = await createPlayer('訂正名簿選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-09-01',
      status: 'unconfirmed',
      eligibleGrades: ['A'],
    })
    const oldRoster = await publishRoster(edition.id, event.entryGroupId, 'A', '2024-08-01', [
      { playerId: oldPlayer.id },
    ])
    await testDb
      .update(tournamentEntryRosters)
      .set({ supersededAt: new Date('2024-08-10T00:00:00Z') })
      .where(eq(tournamentEntryRosters.id, oldRoster.id))
    await publishRoster(
      edition.id,
      event.entryGroupId,
      'A',
      '2024-08-10',
      [{ playerId: correctedPlayer.id }],
      2,
    )

    const result = await getAppearanceCounts(
      {
        playerIds: [oldPlayer.id, correctedPlayer.id],
        associationYear: 2024,
        referenceDate: '2024-08-31',
      },
      testDb,
    )

    expect(result.playerCounts).toEqual([
      { playerId: oldPlayer.id, count: 0 },
      { playerId: correctedPlayer.id, count: 1 },
    ])
  })

  it('counts applied entries when an applicant roster is explicitly published as confirmed', async () => {
    const player = await createPlayer('申込確定兼用選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-09-01',
      status: 'unconfirmed',
      eligibleGrades: ['A'],
    })
    const [applicantRoster] = await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId: event.entryGroupId, rosterType: 'applicant', version: 1, publishedAt: '2024-08-01' })
      .returning()
    await testDb.insert(tournamentEntryRosterEntries).values({
      rosterId: applicantRoster!.id,
      playerId: player.id,
      grade: 'A',
      rawName: player.displayName,
      status: 'applied',
      selectionOutcome: 'unknown',
    })
    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: edition.id,
      grade: 'A',
      rosterId: applicantRoster!.id,
      publishedAt: '2024-08-01',
    })

    const result = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2024-08-31' },
      testDb,
    )

    expect(result.playerCounts).toEqual([{ playerId: player.id, count: 1 }])
    expect(result.completeness).toBe('complete')
  })

  it('returns incomplete with edition/grade reasons for unknown category and missing sources', async () => {
    const player = await createPlayer('不足確認選手')
    const unknown = await createEdition({
      editionNumber: 1,
      eventDate: '2024-05-01',
      category: 'unknown',
      eligibleGrades: ['C'],
    })
    await addActiveFact(unknown.edition.id, 'C', null)

    const missingBoth = await createEdition({
      editionNumber: 2,
      eventDate: '2024-06-01',
      eligibleGrades: ['A'],
    })
    await addActiveFact(missingBoth.edition.id, 'A', null)

    const missingResult = await createEdition({
      editionNumber: 3,
      eventDate: '2024-07-01',
      eligibleGrades: ['B'],
    })
    await publishRoster(
      missingResult.edition.id,
      missingResult.event.entryGroupId,
      'B',
      '2024-06-20',
      [{ playerId: player.id }],
    )
    await addActiveFact(missingResult.edition.id, 'B', null)

    const result = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2025-03-31' },
      testDb,
    )

    expect(result.completeness).toBe('incomplete')
    expect(result.missing).toEqual(
      expect.arrayContaining([
        {
          editionId: unknown.edition.id,
          grade: 'C',
          reason: 'unknown_competition_category',
        },
        {
          editionId: missingBoth.edition.id,
          grade: 'A',
          reason: 'missing_confirmed_roster',
        },
        {
          editionId: missingBoth.edition.id,
          grade: 'A',
          reason: 'missing_actual_result',
        },
        {
          editionId: missingResult.edition.id,
          grade: 'B',
          reason: 'missing_actual_result',
        },
      ]),
    )
  })

  it('does not report complete when one eligible grade is entirely absent', async () => {
    const player = await createPlayer('部分級選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-08-01',
      eligibleGrades: ['A', 'B'],
    })
    await publishRoster(edition.id, event.entryGroupId, 'A', '2024-07-01', [{ playerId: player.id }])
    const resultClass = await createActualResult(edition.id, 'A', '2024-08-01', [player.id])
    await addActiveFact(edition.id, 'A', resultClass.id)

    const result = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2025-03-31' },
      testDb,
    )

    expect(result.playerCounts).toEqual([{ playerId: player.id, count: 1 }])
    expect(result.completeness).toBe('incomplete')
    expect(result.missing).toEqual(expect.arrayContaining([
      { editionId: edition.id, grade: 'B', reason: 'missing_confirmed_roster' },
      { editionId: edition.id, grade: 'B', reason: 'missing_actual_result' },
    ]))
  })

  it('reports an unknown grade scope instead of deriving completeness from present sources', async () => {
    const player = await createPlayer('級範囲不明選手')
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-08-01',
      eligibleGrades: [],
    })
    await publishRoster(edition.id, event.entryGroupId, 'A', '2024-07-01', [{ playerId: player.id }])
    const resultClass = await createActualResult(edition.id, 'A', '2024-08-01', [player.id])
    await addActiveFact(edition.id, 'A', resultClass.id)

    const result = await getAppearanceCounts(
      { playerIds: [player.id], associationYear: 2024, referenceDate: '2025-03-31' },
      testDb,
    )

    expect(result.completeness).toBe('incomplete')
    expect(result.missing).toContainEqual({
      editionId: edition.id,
      grade: null,
      reason: 'unknown_grade_scope',
    })
  })

  it('batches member counts in one query and returns zero for members without a linked player', async () => {
    const member = await createUser({ name: '会員選手' })
    const emptyMember = await createUser({ name: '出場なし会員' })
    const player = await createPlayer('会員選手', member.id)
    const { edition, event } = await createEdition({
      editionNumber: 1,
      eventDate: '2024-08-01',
      eligibleGrades: ['D'],
    })
    await publishRoster(edition.id, event.entryGroupId, 'D', '2024-07-20', [
      { playerId: player.id, userId: member.id },
    ])
    const resultClass = await createActualResult(edition.id, 'D', '2024-08-01', [player.id])
    await addActiveFact(edition.id, 'D', resultClass.id)

    const executeSpy = vi.spyOn(testDb, 'execute')
    const result = await getAppearanceCounts(
      {
        userIds: [member.id, emptyMember.id],
        associationYear: 2024,
        referenceDate: '2025-03-31',
      },
      testDb,
    )

    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(result.memberCounts).toEqual([
      { userId: member.id, count: 1 },
      { userId: emptyMember.id, count: 0 },
    ])
  })

  it('rejects ambiguous or invalid subject input before querying', async () => {
    await expect(
      getAppearanceCounts(
        { playerIds: [1], userIds: ['u1'], associationYear: 2024, referenceDate: '2025-03-31' },
        testDb,
      ),
    ).rejects.toThrow('playerIds または userIds')
    await expect(
      getAppearanceCounts(
        { playerIds: [], associationYear: 2024, referenceDate: '2025-03-31' },
        testDb,
      ),
    ).rejects.toThrow('1件以上')
    await expect(
      getAppearanceCounts(
        { playerIds: [1], associationYear: 2024, referenceDate: '2025-02-30' },
        testDb,
      ),
    ).rejects.toThrow('基準日')
  })

  it('uses the source-selection indexes in the appearance-count query plan', async () => {
    const query = buildAppearanceCountsQuery({
      playerIds: [1],
      associationYear: 2024,
      referenceDate: '2025-03-31',
    })
    await testDb.execute(sql`SET enable_seqscan = off`)
    try {
      const explained = await testDb.execute(sql`EXPLAIN (COSTS OFF) ${query}`)
      const plan = explained.rows.map((row) => String(row['QUERY PLAN'])).join('\n')
      expect(plan).toMatch(/tcrp_edition_grade_published_idx/)
      expect(plan).toMatch(/tournament_edition_grade_lottery_facts_active_key/)
      expect(plan).toMatch(/roster_entries_roster_grade_player_idx|idx_participants_class_id/)
    } finally {
      await testDb.execute(sql`RESET enable_seqscan`)
    }
  })
})
