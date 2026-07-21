import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  events,
  tournamentClasses,
  tournamentConfirmedRosterPublications,
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosters,
  tournaments,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { getLotteryCoverageReport } from '../../src/roster-import/coverage-report.js'
import { closeTestDb, testDb } from '../test-db.js'

describe('getLotteryCoverageReport', () => {
  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE TABLE tournament_series RESTART IDENTITY CASCADE`)
  })

  afterAll(closeTestDb)

  it('does not call an empty range complete', async () => {
    const report = await getLotteryCoverageReport(testDb, {
      fromYear: 2024,
      now: new Date('2026-07-21T00:00:00Z'),
    })
    expect(report.complete).toBe(false)
    expect(report.totals.editions).toBe(0)
  })

  it('reports unknown categories and missing confirmed/result sources without guessing', async () => {
    const [series] = await testDb.insert(tournamentSeries).values({ name: 'coverage test' }).returning()
    const [covered, unknown, missing] = await testDb.insert(tournamentSeriesEditions).values([
      { seriesId: series!.id, editionNumber: 1, year: 2024, status: 'held', competitionCategory: 'official' },
      { seriesId: series!.id, editionNumber: 2, year: 2024, status: 'held', competitionCategory: 'unknown' },
      { seriesId: series!.id, editionNumber: 3, year: 2025, status: 'held', competitionCategory: 'new_year' },
    ]).returning()
    expect(unknown).toBeTruthy()
    expect(missing).toBeTruthy()

    const [event] = await testDb.insert(events).values({
      title: 'covered event',
      eventDate: '2024-05-01',
      editionId: covered!.id,
      eligibleGrades: ['A'],
    }).returning()
    const [roster] = await testDb.insert(tournamentEntryRosters).values({
      eventId: event!.id,
      rosterType: 'confirmed',
      approvedAt: new Date('2024-04-20T00:00:00Z'),
    }).returning()
    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: covered!.id,
      grade: 'A',
      rosterId: roster!.id,
      publishedAt: '2024-04-20',
    })
    const [tournament] = await testDb.insert(tournaments).values({
      name: 'covered result',
      eventDate: '2024-05-01',
      editionId: covered!.id,
    }).returning()
    const [tournamentClass] = await testDb.insert(tournamentClasses).values({
      tournamentId: tournament!.id,
      className: 'A級',
      grade: 'A',
    }).returning()
    await testDb.insert(tournamentEditionGradeLotteryFacts).values({
      editionId: covered!.id,
      grade: 'A',
      selectionStatus: 'unknown',
      actualResultClassId: tournamentClass!.id,
    })

    const report = await getLotteryCoverageReport(testDb, {
      fromYear: 2024,
      now: new Date('2026-07-21T00:00:00Z'),
    })
    expect(report.generatedAt).toBe('2026-07-21T00:00:00.000Z')
    expect(report.complete).toBe(false)
    expect(report.byYear).toEqual([
      {
        year: 2024,
        editions: 2,
        unknownCategory: 1,
        missingReferenceDate: 1,
        missingGradeScope: 0,
        eligibleHeldEditions: 1,
        withConfirmedRoster: 1,
        withActualResult: 1,
        missingConfirmedRoster: 0,
        missingActualResult: 0,
      },
      {
        year: 2025,
        editions: 1,
        unknownCategory: 0,
        missingReferenceDate: 1,
        missingGradeScope: 1,
        eligibleHeldEditions: 1,
        withConfirmedRoster: 0,
        withActualResult: 0,
        missingConfirmedRoster: 1,
        missingActualResult: 1,
      },
    ])
  })

  it('requires confirmed and actual sources for every eligible grade', async () => {
    const [series] = await testDb.insert(tournamentSeries).values({ name: 'partial grade coverage' }).returning()
    const [edition] = await testDb.insert(tournamentSeriesEditions).values({
      seriesId: series!.id,
      editionNumber: 1,
      year: 2024,
      status: 'held',
      competitionCategory: 'official',
    }).returning()
    const [event] = await testDb.insert(events).values({
      title: 'partial event',
      eventDate: '2024-05-01',
      editionId: edition!.id,
      eligibleGrades: ['A', 'B'],
    }).returning()
    const [roster] = await testDb.insert(tournamentEntryRosters).values({
      eventId: event!.id,
      rosterType: 'confirmed',
    }).returning()
    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: edition!.id,
      grade: 'A',
      rosterId: roster!.id,
      publishedAt: '2024-04-20',
    })
    const [tournament] = await testDb.insert(tournaments).values({
      name: 'partial result',
      eventDate: '2024-05-01',
      editionId: edition!.id,
    }).returning()
    const [tournamentClass] = await testDb.insert(tournamentClasses).values({
      tournamentId: tournament!.id,
      className: 'A級',
      grade: 'A',
    }).returning()
    await testDb.insert(tournamentEditionGradeLotteryFacts).values({
      editionId: edition!.id,
      grade: 'A',
      selectionStatus: 'unknown',
      actualResultClassId: tournamentClass!.id,
    })

    const report = await getLotteryCoverageReport(testDb, { fromYear: 2024, toYear: 2024 })

    expect(report.complete).toBe(false)
    expect(report.byYear[0]).toMatchObject({
      eligibleHeldEditions: 1,
      missingGradeScope: 0,
      withConfirmedRoster: 0,
      withActualResult: 0,
      missingConfirmedRoster: 1,
      missingActualResult: 1,
    })
  })
})
