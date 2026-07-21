import { describe, expect, it } from 'vitest'
import {
  competitionCategoryEnum,
  lotterySelectionStatusEnum,
  rosterImportDraftStatusEnum,
  rosterImportSourceKindEnum,
  selectionOutcomeEnum,
  tournamentConfirmedRosterPublications,
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
  tournamentRosterImportDrafts,
  tournamentSeriesEditions,
} from '../src/schema'

describe('tournament-lottery-trends schema', () => {
  it('declares persisted enum values in stable order', () => {
    expect(competitionCategoryEnum.enumValues).toEqual([
      'official',
      'new_year',
      'hosted',
      'supported',
      'other',
      'unknown',
    ])
    expect(selectionOutcomeEnum.enumValues).toEqual([
      'accepted',
      'waitlisted',
      'rejected',
      'unknown',
    ])
    expect(lotterySelectionStatusEnum.enumValues).toEqual([
      'lottery',
      'under_capacity',
      'no_capacity',
      'unknown',
    ])
    expect(rosterImportDraftStatusEnum.enumValues).toEqual([
      'pending_review',
      'approved',
      'rejected',
      'parse_failed',
      'superseded',
    ])
    expect(rosterImportSourceKindEnum.enumValues).toEqual(['attachment', 'body'])
  })

  it('defaults existing editions and roster rows to safe, non-published values', () => {
    expect(tournamentSeriesEditions.competitionCategory.notNull).toBe(true)
    expect(tournamentSeriesEditions.competitionCategory.default).toBe('unknown')
    expect(tournamentEntryRosters.version.notNull).toBe(true)
    expect(tournamentEntryRosters.version.default).toBe(1)
    expect(tournamentEntryRosterEntries.selectionOutcome.default).toBe('unknown')
    expect(tournamentEntryRosterEntries.selectionExempt.default).toBe(false)
  })

  it('defines versioning and audit columns without changing the event-owned roster contract', () => {
    expect(tournamentEntryRosters.eventId.notNull).toBe(true)
    expect(tournamentEntryRosters.sourceMailMessageId.name).toBe('source_mail_message_id')
    expect(tournamentEntryRosters.supersedesRosterId.name).toBe('supersedes_roster_id')
    expect(tournamentEntryRosters.supersededAt.name).toBe('superseded_at')
    expect(tournamentEntryRosters.approvedByUserId.name).toBe('approved_by_user_id')
  })

  it('defines publication, active fact and review-draft source contracts', () => {
    expect(tournamentConfirmedRosterPublications.editionId.notNull).toBe(true)
    expect(tournamentConfirmedRosterPublications.grade.notNull).toBe(true)
    expect(tournamentConfirmedRosterPublications.rosterId.notNull).toBe(false)
    expect(tournamentConfirmedRosterPublications.publishedAt.notNull).toBe(true)

    expect(tournamentEditionGradeLotteryFacts.selectionStatus.default).toBe('unknown')
    expect(tournamentEditionGradeLotteryFacts.capacity.notNull).toBe(false)
    expect(tournamentEditionGradeLotteryFacts.selectionRuleEvidence.name).toBe(
      'selection_rule_evidence',
    )
    expect(tournamentEditionGradeLotteryFacts.validTo.notNull).toBe(false)
    expect(tournamentEditionGradeLotteryFacts.supersedesFactId.name).toBe(
      'supersedes_fact_id',
    )

    expect(tournamentRosterImportDrafts.parserVersion.notNull).toBe(true)
    expect(tournamentRosterImportDrafts.sourceKind.notNull).toBe(true)
    expect(tournamentRosterImportDrafts.status.default).toBe('pending_review')
    expect(tournamentRosterImportDrafts.extractedPayload.notNull).toBe(true)
    expect(tournamentRosterImportDrafts.sourceAttachmentId.notNull).toBe(false)
    expect(tournamentRosterImportDrafts.sourceMailMessageId.notNull).toBe(false)
  })
})
