import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { APPEARANCE_COUNT_RULE_VERSION } from './appearance-counts'
import { getSeriesLotteryMetrics } from './series-metrics'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
type SelectionOutcome = 'accepted' | 'waitlisted' | 'rejected' | 'unknown'

let verifierId: string

beforeEach(async () => {
  await truncateAll()
  verifierId = 'lottery-metrics-verifier'
  await testDb.insert(users).values({ id: verifierId, name: '倍率確認者', role: 'admin' })
})
afterAll(closeTestDb)

async function createSeries(name = '倍率テスト大会') {
  const [series] = await testDb.insert(tournamentSeries).values({ name }).returning()
  return series!
}

async function createEdition(
  seriesId: number,
  editionNumber: number,
  eventDate: string,
  options: {
    category?: 'official' | 'new_year' | 'hosted' | 'supported' | 'other' | 'unknown'
    capacity?: number | null
    capacityA?: number | null
  } = {},
) {
  const [edition] = await testDb
    .insert(tournamentSeriesEditions)
    .values({
      seriesId,
      editionNumber,
      year: Number(eventDate.slice(0, 4)),
      status: 'held',
      competitionCategory: options.category ?? 'official',
    })
    .returning()
  const [event] = await testDb
    .insert(events)
    .values({
      title: `${editionNumber}回大会`,
      eventDate,
      editionId: edition!.id,
      capacity: options.capacity ?? null,
      capacityA: options.capacityA ?? null,
    })
    .returning()
  return { edition: edition!, event: event! }
}

async function createRoster(
  eventId: number,
  rosterType: 'applicant' | 'confirmed',
  grade: Grade,
  entries: Array<{
    name: string
    playerId?: number | null
    outcome?: SelectionOutcome
    selectionExempt?: boolean
  }>,
  version = 1,
) {
  const [roster] = await testDb
    .insert(tournamentEntryRosters)
    .values({ eventId, rosterType, version, approvedAt: new Date() })
    .returning()
  if (entries.length > 0) {
    const rosterEntryStatus: 'applied' | 'confirmed' =
      rosterType === 'applicant' ? 'applied' : 'confirmed'
    await testDb.insert(tournamentEntryRosterEntries).values(
      entries.map((entry, index) => ({
        rosterId: roster!.id,
        playerId: entry.playerId ?? null,
        grade,
        rawName: entry.name,
        status: rosterEntryStatus,
        selectionOutcome: entry.outcome ?? (rosterType === 'confirmed' ? 'accepted' : 'unknown'),
        selectionExempt: entry.selectionExempt ?? false,
        seqNo: index + 1,
      })),
    )
  }
  return roster!
}

async function createFact(input: {
  editionId: number
  grade: Grade
  status: 'lottery' | 'under_capacity' | 'no_capacity' | 'unknown'
  capacity: number | null
  applicantRosterId: number | null
  selectionResultRosterId?: number | null
  applicationStartDate?: string | null
  ruleVersion?: string | null
  actualResultClassId?: number | null
}) {
  const [fact] = await testDb
    .insert(tournamentEditionGradeLotteryFacts)
    .values({
      editionId: input.editionId,
      grade: input.grade,
      selectionStatus: input.status,
      capacity: input.capacity,
      applicantRosterId: input.applicantRosterId,
      selectionResultRosterId: input.selectionResultRosterId ?? null,
      applicationStartDate: input.applicationStartDate ?? null,
      selectionRuleVersion: input.ruleVersion ?? null,
      actualResultClassId: input.actualResultClassId ?? null,
      verifiedAt: new Date(),
      verifiedByUserId: verifierId,
    })
    .returning()
  return fact!
}

function entries(count: number, prefix: string, outcome?: SelectionOutcome) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${index + 1}`,
    outcome,
  }))
}

async function createPlayer(name: string) {
  const [player] = await testDb
    .insert(players)
    .values({ displayName: name, normalizedName: name })
    .returning()
  return player!
}

async function addHistoricalAppearance(
  seriesId: number,
  editionNumber: number,
  eventDate: string,
  playerIds: number[],
) {
  const { edition, event } = await createEdition(seriesId, editionNumber, eventDate)
  const roster = await createRoster(
    event.id,
    'confirmed',
    'A',
    playerIds.map((playerId) => ({ name: `履歴${playerId}`, playerId, outcome: 'accepted' })),
  )
  await testDb.insert(tournamentConfirmedRosterPublications).values({
    editionId: edition.id,
    grade: 'A',
    rosterId: roster.id,
    publishedAt: eventDate,
  })
  const [tournament] = await testDb
    .insert(tournaments)
    .values({ name: `履歴大会${editionNumber}`, editionId: edition.id, eventDate })
    .returning()
  const [tournamentClass] = await testDb
    .insert(tournamentClasses)
    .values({ tournamentId: tournament!.id, className: 'A級', grade: 'A' })
    .returning()
  await testDb.insert(tournamentParticipants).values(
    playerIds.map((playerId, index) => ({
      classId: tournamentClass!.id,
      playerId,
      name: `履歴${playerId}`,
      seqNo: index + 1,
    })),
  )
  await createFact({
    editionId: edition.id,
    grade: 'A',
    status: 'unknown',
    capacity: null,
    applicantRosterId: null,
    actualResultClassId: tournamentClass!.id,
  })
}

describe('getSeriesLotteryMetrics', () => {
  it('keeps A-E separate and freezes the lottery ratio at the active source pointers', async () => {
    const series = await createSeries()
    const { edition, event } = await createEdition(series.id, 1, '2025-02-01')
    const applicants = await createRoster(event.id, 'applicant', 'B', entries(150, '申込'))
    const selection = await createRoster(event.id, 'confirmed', 'B', [
      ...entries(100, '当選', 'accepted'),
      ...entries(25, '待機', 'waitlisted'),
      ...entries(25, '落選', 'rejected'),
    ])
    await createFact({
      editionId: edition.id,
      grade: 'B',
      status: 'lottery',
      capacity: 100,
      applicantRosterId: applicants.id,
      selectionResultRosterId: selection.id,
    })

    const first = await getSeriesLotteryMetrics(series.id, testDb)
    const point = first.points.find((item) => item.grade === 'B')!
    expect(point).toMatchObject({
      grade: 'B',
      completeness: 'complete',
      applicantCount: 150,
      acceptedCount: 100,
      waitlistedCount: 25,
      rejectedCount: 25,
      lotteryRatio: { numerator: 150, denominator: 100, formatted: '1.50' },
    })
    expect(first.points.some((item) => item.grade === 'A')).toBe(false)

    const later = await createRoster(event.id, 'confirmed', 'B', entries(40, '後日確定', 'accepted'), 2)
    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: edition.id,
      grade: 'B',
      rosterId: later.id,
      publishedAt: '2025-02-10',
    })

    const frozen = (await getSeriesLotteryMetrics(series.id, testDb)).points[0]!
    expect(frozen.acceptedCount).toBe(100)
    expect(frozen.lotteryRatio?.formatted).toBe('1.50')
  })

  it('reports under-capacity and no-capacity data without using whole-event capacity', async () => {
    const series = await createSeries()
    const under = await createEdition(series.id, 1, '2025-02-01')
    const underApplicants = await createRoster(
      under.event.id,
      'applicant',
      'C',
      entries(80, 'C申込'),
    )
    await createFact({
      editionId: under.edition.id,
      grade: 'C',
      status: 'under_capacity',
      capacity: 100,
      applicantRosterId: underApplicants.id,
    })

    const unlimited = await createEdition(series.id, 2, '2026-02-01', {
      capacity: 500,
      capacityA: 100,
    })
    const unlimitedApplicants = await createRoster(
      unlimited.event.id,
      'applicant',
      'D',
      entries(30, 'D申込'),
    )
    await createFact({
      editionId: unlimited.edition.id,
      grade: 'D',
      status: 'no_capacity',
      capacity: null,
      applicantRosterId: unlimitedApplicants.id,
    })

    const result = await getSeriesLotteryMetrics(series.id, testDb)
    expect(result.points.find((item) => item.grade === 'C')).toMatchObject({
      applicantCount: 80,
      capacity: 100,
      remainingSlots: 20,
      occupancy: { numerator: 80, denominator: 100, percentage: 80, formatted: '80%' },
      lotteryRatio: null,
    })
    expect(result.points.find((item) => item.grade === 'D')).toMatchObject({
      selectionStatus: 'no_capacity',
      applicantCount: 30,
      capacity: null,
      remainingSlots: null,
      occupancy: null,
      lotteryRatio: null,
      completeness: 'complete',
    })
  })

  it('marks duplicate, zero-denominator, and missing adopted sources incomplete instead of filling zeroes', async () => {
    const series = await createSeries()

    const duplicateEdition = await createEdition(series.id, 1, '2024-06-01')
    const duplicateRoster = await createRoster(duplicateEdition.event.id, 'applicant', 'C', [
      { name: '重 複' },
      { name: '重複' },
    ])
    await createFact({
      editionId: duplicateEdition.edition.id,
      grade: 'C',
      status: 'under_capacity',
      capacity: 10,
      applicantRosterId: duplicateRoster.id,
    })

    const zeroEdition = await createEdition(series.id, 2, '2024-07-01')
    const zeroApplicants = await createRoster(zeroEdition.event.id, 'applicant', 'B', entries(2, '申込'))
    const zeroSelection = await createRoster(
      zeroEdition.event.id,
      'confirmed',
      'B',
      entries(2, '落選', 'rejected'),
    )
    await createFact({
      editionId: zeroEdition.edition.id,
      grade: 'B',
      status: 'lottery',
      capacity: 2,
      applicantRosterId: zeroApplicants.id,
      selectionResultRosterId: zeroSelection.id,
    })

    const missingEdition = await createEdition(series.id, 3, '2024-08-01')
    await createFact({
      editionId: missingEdition.edition.id,
      grade: 'E',
      status: 'lottery',
      capacity: 10,
      applicantRosterId: null,
      selectionResultRosterId: null,
    })

    const result = await getSeriesLotteryMetrics(series.id, testDb)
    const duplicate = result.points.find((item) => item.grade === 'C')!
    expect(duplicate.completeness).toBe('incomplete')
    expect(duplicate.missingReasons).toContain('duplicate_applicant_entries')

    const zero = result.points.find((item) => item.grade === 'B')!
    expect(zero.completeness).toBe('incomplete')
    expect(zero.acceptedCount).toBe(0)
    expect(zero.lotteryRatio).toBeNull()
    expect(zero.missingReasons).toContain('empty_accepted_selection_result')

    const missing = result.points.find((item) => item.grade === 'E')!
    expect(missing.completeness).toBe('incomplete')
    expect(missing.applicantCount).toBeNull()
    expect(missing.missingReasons).toContain('missing_applicant_roster')
  })

  it('uses only the active fact revision and changes the ratio after an explicit correction', async () => {
    const series = await createSeries()
    const { edition, event } = await createEdition(series.id, 1, '2025-02-01')
    const oldApplicants = await createRoster(event.id, 'applicant', 'B', entries(150, '旧申込'))
    const oldSelection = await createRoster(event.id, 'confirmed', 'B', entries(100, '旧当選', 'accepted'))
    const oldFact = await createFact({
      editionId: edition.id,
      grade: 'B',
      status: 'lottery',
      capacity: 100,
      applicantRosterId: oldApplicants.id,
      selectionResultRosterId: oldSelection.id,
    })
    await testDb.update(tournamentEditionGradeLotteryFacts)
      .set({ validTo: new Date() })
      .where(eq(tournamentEditionGradeLotteryFacts.id, oldFact.id))

    const newApplicants = await createRoster(event.id, 'applicant', 'B', entries(120, '新申込'), 2)
    const newSelection = await createRoster(event.id, 'confirmed', 'B', entries(60, '新当選', 'accepted'), 2)
    await createFact({
      editionId: edition.id,
      grade: 'B',
      status: 'lottery',
      capacity: 60,
      applicantRosterId: newApplicants.id,
      selectionResultRosterId: newSelection.id,
    })

    const result = await getSeriesLotteryMetrics(series.id, testDb)
    expect(result.points).toHaveLength(1)
    expect(result.points[0]).toMatchObject({
      applicantCount: 120,
      acceptedCount: 60,
      lotteryRatio: { numerator: 120, denominator: 60, formatted: '2.00' },
    })
  })

  it('does not follow wrong-event or wrong-type roster pointers', async () => {
    const series = await createSeries()
    const target = await createEdition(series.id, 1, '2025-02-01')
    const other = await createEdition(series.id, 2, '2025-03-01')
    const wrongApplicant = await createRoster(other.event.id, 'applicant', 'B', entries(10, '別開催'))
    const wrongSelectionType = await createRoster(target.event.id, 'applicant', 'B', entries(5, '申込型'), 1)
    await createFact({
      editionId: target.edition.id,
      grade: 'B',
      status: 'lottery',
      capacity: 5,
      applicantRosterId: wrongApplicant.id,
      selectionResultRosterId: wrongSelectionType.id,
    })

    const point = (await getSeriesLotteryMetrics(series.id, testDb)).points
      .find((candidate) => candidate.editionId === target.edition.id)!
    expect(point.completeness).toBe('incomplete')
    expect(point.missingReasons).toEqual(expect.arrayContaining([
      'invalid_applicant_roster',
      'invalid_selection_result_roster',
    ]))
    expect(point.lotteryRatio).toBeNull()
  })

  it('treats capacity equality as a between-band line and suppresses it when history is incomplete', async () => {
    const series = await createSeries()
    const organizer = await createPlayer('等号主催者')
    const zero = await createPlayer('等号零回')
    const one = await createPlayer('等号一回')
    await addHistoricalAppearance(series.id, 1, '2024-05-01', [one.id])

    const target = await createEdition(series.id, 3, '2025-05-01')
    const applicantRows = [
      { name: organizer.displayName, playerId: organizer.id, selectionExempt: true },
      { name: zero.displayName, playerId: zero.id },
      { name: one.displayName, playerId: one.id },
    ]
    const applicants = await createRoster(target.event.id, 'applicant', 'A', applicantRows)
    const selection = await createRoster(target.event.id, 'confirmed', 'A', applicantRows.map((entry) => ({
      ...entry,
      outcome: 'accepted' as const,
    })))
    await createFact({
      editionId: target.edition.id,
      grade: 'A',
      status: 'lottery',
      capacity: 2,
      applicantRosterId: applicants.id,
      selectionResultRosterId: selection.id,
      applicationStartDate: '2025-04-01',
      ruleVersion: APPEARANCE_COUNT_RULE_VERSION,
    })

    const complete = (await getSeriesLotteryMetrics(series.id, testDb)).points
      .find((candidate) => candidate.editionId === target.edition.id)!
    expect(complete.aGradeCutoff).toMatchObject({
      completeness: 'complete',
      associationYear: 2024,
      referenceDate: '2025-03-31',
      capacityLine: {
        boundaryAppearanceCount: null,
        applicantsBeforeBoundary: null,
        applicantsInBoundary: null,
        remainingSlots: 0,
      },
    })

    await createEdition(series.id, 2, '2024-08-01')
    const incomplete = (await getSeriesLotteryMetrics(series.id, testDb)).points
      .find((candidate) => candidate.editionId === target.edition.id)!
    expect(incomplete.aGradeCutoff?.completeness).toBe('incomplete')
    expect(incomplete.aGradeCutoff?.missingReasons).toContain('incomplete_appearance_history')
    expect(incomplete.aGradeCutoff?.capacityLine?.boundaryAppearanceCount).toBeNull()
  })

  it('batches A-grade history, separates organizer slots, and returns the strict capacity boundary', async () => {
    const series = await createSeries()
    const organizer = await createPlayer('主催者枠')
    const zero = await createPlayer('零回')
    const one = await createPlayer('一回')
    const twoAccepted = await createPlayer('二回当選')
    const twoWaitlisted = await createPlayer('二回待機')
    const twoRejected = await createPlayer('二回落選')
    const twice = [twoAccepted.id, twoWaitlisted.id, twoRejected.id]

    await addHistoricalAppearance(series.id, 1, '2024-05-01', [one.id, ...twice])
    await addHistoricalAppearance(series.id, 2, '2024-07-01', twice)

    const target = await createEdition(series.id, 3, '2025-02-01')
    const applicantRows = [
      { name: organizer.displayName, playerId: organizer.id, selectionExempt: true },
      { name: zero.displayName, playerId: zero.id },
      { name: one.displayName, playerId: one.id },
      { name: twoAccepted.displayName, playerId: twoAccepted.id },
      { name: twoWaitlisted.displayName, playerId: twoWaitlisted.id },
      { name: twoRejected.displayName, playerId: twoRejected.id },
    ]
    const applicants = await createRoster(target.event.id, 'applicant', 'A', applicantRows)
    const selection = await createRoster(target.event.id, 'confirmed', 'A', [
      { ...applicantRows[0]!, outcome: 'accepted' },
      { ...applicantRows[1]!, outcome: 'accepted' },
      { ...applicantRows[2]!, outcome: 'accepted' },
      { ...applicantRows[3]!, outcome: 'accepted' },
      { ...applicantRows[4]!, outcome: 'waitlisted' },
      { ...applicantRows[5]!, outcome: 'rejected' },
    ])
    await createFact({
      editionId: target.edition.id,
      grade: 'A',
      status: 'lottery',
      capacity: 4,
      applicantRosterId: applicants.id,
      selectionResultRosterId: selection.id,
      applicationStartDate: '2025-01-10',
      ruleVersion: APPEARANCE_COUNT_RULE_VERSION,
    })

    let queryCount = 0
    const countingDb = {
      execute: async (query: Parameters<typeof testDb.execute>[0]) => {
        queryCount += 1
        return testDb.execute(query)
      },
    }
    const result = await getSeriesLotteryMetrics(
      series.id,
      countingDb as unknown as Parameters<typeof getSeriesLotteryMetrics>[1],
    )
    expect(queryCount).toBe(2)

    const point = result.points.find((item) => item.editionId === target.edition.id)!
    expect(point.aGradeCutoff?.missingReasons).toEqual([])
    expect(point.aGradeCutoff).toMatchObject({
      completeness: 'complete',
      associationYear: 2024,
      referenceDate: '2025-01-09',
      ruleVersion: APPEARANCE_COUNT_RULE_VERSION,
      organizerSlots: {
        applicantCount: 1,
        acceptedCount: 1,
        waitlistedCount: 0,
        rejectedCount: 0,
      },
      appearanceBuckets: [
        { appearanceCount: 0, applicantCount: 1, acceptedCount: 1 },
        { appearanceCount: 1, applicantCount: 1, acceptedCount: 1 },
        {
          appearanceCount: 2,
          applicantCount: 3,
          acceptedCount: 1,
          waitlistedCount: 1,
          rejectedCount: 1,
        },
      ],
      capacityLine: {
        capacity: 4,
        boundaryAppearanceCount: 2,
        applicantsBeforeBoundary: 3,
        applicantsInBoundary: 3,
        acceptedInBoundary: 1,
        waitlistedInBoundary: 1,
        rejectedInBoundary: 1,
        remainingSlots: 0,
      },
    })

    const serialized = JSON.stringify(result)
    for (const privateValue of applicantRows.map((entry) => entry.name)) {
      expect(serialized).not.toContain(privateValue)
    }
    expect(serialized).not.toMatch(/playerId|userId|rosterId|mail|attachment|source/i)
  })
})
