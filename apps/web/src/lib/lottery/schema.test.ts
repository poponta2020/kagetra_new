import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  mailAttachments,
  tournamentConfirmedRosterPublications,
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosters,
  tournamentRosterImportDrafts,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createMailMessage } from '@/test-utils/seed'

async function createEdition() {
  const [series] = await testDb
    .insert(tournamentSeries)
    .values({ name: `schema-series-${crypto.randomUUID()}` })
    .returning()
  const [edition] = await testDb
    .insert(tournamentSeriesEditions)
    .values({ seriesId: series!.id, editionNumber: 1, year: 2030, status: 'held' })
    .returning()
  if (!edition) throw new Error('failed to create edition')
  return edition
}

async function createRoster(entryGroupId: number, version = 1) {
  const [roster] = await testDb
    .insert(tournamentEntryRosters)
    .values({ entryGroupId, rosterType: 'applicant', version })
    .returning()
  if (!roster) throw new Error('failed to create roster')
  return roster
}

describe('tournament-lottery-trends schema constraints', () => {
  beforeEach(truncateAll)
  afterAll(closeTestDb)

  it('keeps multiple roster versions while rejecting a duplicate version', async () => {
    const event = await createEvent()
    await createRoster(event.entryGroupId, 1)
    await createRoster(event.entryGroupId, 2)

    expect(await testDb.select().from(tournamentEntryRosters)).toHaveLength(2)
    await expect(createRoster(event.entryGroupId, 2)).rejects.toThrow()
  })

  it('allows an applicant roster to serve as an explicit confirmed publication', async () => {
    const edition = await createEdition()
    const event = await createEvent({ editionId: edition.id })
    const roster = await createRoster(event.entryGroupId)

    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: edition.id,
      grade: 'A',
      rosterId: roster.id,
      publishedAt: '2030-01-02',
    })

    const [publication] = await testDb.select().from(tournamentConfirmedRosterPublications)
    expect(publication?.rosterId).toBe(roster.id)
  })

  it('enforces one active fact per edition/grade and status-capacity consistency', async () => {
    const edition = await createEdition()
    await testDb.insert(tournamentEditionGradeLotteryFacts).values({
      editionId: edition.id,
      grade: 'A',
      selectionStatus: 'lottery',
      capacity: 100,
    })

    await expect(
      testDb.insert(tournamentEditionGradeLotteryFacts).values({
        editionId: edition.id,
        grade: 'A',
        selectionStatus: 'unknown',
      }),
    ).rejects.toThrow()
    await expect(
      testDb.insert(tournamentEditionGradeLotteryFacts).values({
        editionId: edition.id,
        grade: 'B',
        selectionStatus: 'no_capacity',
        capacity: 1,
      }),
    ).rejects.toThrow()
    await expect(
      testDb.insert(tournamentEditionGradeLotteryFacts).values({
        editionId: edition.id,
        grade: 'C',
        selectionStatus: 'under_capacity',
        capacity: 0,
      }),
    ).rejects.toThrow()
  })

  it('preserves audit rows and nulls source pointers when a roster is deleted', async () => {
    const edition = await createEdition()
    const event = await createEvent({ editionId: edition.id })
    const roster = await createRoster(event.entryGroupId)
    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: edition.id,
      grade: 'A',
      rosterId: roster.id,
      publishedAt: '2030-01-02',
    })
    await testDb.insert(tournamentEditionGradeLotteryFacts).values({
      editionId: edition.id,
      grade: 'A',
      applicantRosterId: roster.id,
    })

    await testDb.delete(tournamentEntryRosters).where(eq(tournamentEntryRosters.id, roster.id))

    const [publication] = await testDb.select().from(tournamentConfirmedRosterPublications)
    const [fact] = await testDb.select().from(tournamentEditionGradeLotteryFacts)
    expect(publication?.rosterId).toBeNull()
    expect(fact?.applicantRosterId).toBeNull()
  })

  it('deduplicates attachment and body-only roster drafts independently', async () => {
    const mail = await createMailMessage()
    const [attachment] = await testDb
      .insert(mailAttachments)
      .values({
        mailMessageId: mail.id,
        filename: 'roster.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 3,
        data: Buffer.from('xls'),
      })
      .returning()

    await testDb.insert(tournamentRosterImportDrafts).values({
      sourceKind: 'attachment',
      sourceMailMessageId: mail.id,
      sourceAttachmentId: attachment!.id,
      parserVersion: 'test-1',
    })
    await expect(
      testDb.insert(tournamentRosterImportDrafts).values({
        sourceKind: 'attachment',
        sourceMailMessageId: mail.id,
        sourceAttachmentId: attachment!.id,
        parserVersion: 'test-2',
      }),
    ).rejects.toThrow()

    await testDb.insert(tournamentRosterImportDrafts).values({
      sourceKind: 'body',
      sourceMailMessageId: mail.id,
      parserVersion: 'test-1',
    })
    await expect(
      testDb.insert(tournamentRosterImportDrafts).values({
        sourceKind: 'body',
        sourceMailMessageId: mail.id,
        parserVersion: 'test-2',
      }),
    ).rejects.toThrow()

    await testDb.delete(mailAttachments).where(eq(mailAttachments.id, attachment!.id))
    const drafts = await testDb.select().from(tournamentRosterImportDrafts)
    expect(drafts).toHaveLength(2)
    expect(drafts.find((draft) => draft.sourceKind === 'attachment')?.sourceAttachmentId).toBeNull()
  })

  it('cascades edition-owned facts and publications when an edition is deleted', async () => {
    const edition = await createEdition()
    await testDb.insert(tournamentConfirmedRosterPublications).values({
      editionId: edition.id,
      grade: 'A',
      publishedAt: '2030-01-02',
    })
    await testDb.insert(tournamentEditionGradeLotteryFacts).values({
      editionId: edition.id,
      grade: 'A',
    })

    await testDb
      .delete(tournamentSeriesEditions)
      .where(eq(tournamentSeriesEditions.id, edition.id))

    expect(await testDb.select().from(tournamentConfirmedRosterPublications)).toHaveLength(0)
    expect(await testDb.select().from(tournamentEditionGradeLotteryFacts)).toHaveLength(0)
  })
})
