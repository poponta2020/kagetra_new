import { describe, expect, it } from 'vitest'
import { buildLotteryBackfillReport } from '../../src/roster-import/backfill-report.js'

describe('buildLotteryBackfillReport', () => {
  it('separates deterministic success, review, failure, limits, and resume state', () => {
    const report = buildLotteryBackfillReport({
      fetched: 8,
      failed: 1,
      rosterCandidateMessages: 5,
      rosterCandidateAttachments: 4,
      rosterCandidateBodies: 2,
      rosterCandidatesSelected: 3,
      rosterCandidatesSkippedByLimit: 2,
      rosterAiEligible: 1,
      rosterSourcesSelected: 4,
      rosterSourcesClassified: 3,
      rosterSourcesNeedReview: 1,
      skippedByResumeCursor: 7,
      nextResumeCursor: 456,
      resumeCursorBlockedByFailure: true,
    }, {
      dryRun: true,
      mailbox: '99_202510以前のメール',
      fromYear: 2024,
      toYear: 2025,
      maxCandidates: 3,
      maxAiCalls: 1,
      resumeAfterUid: 400,
    })

    expect(report).toMatchObject({
      schemaVersion: 1,
      mode: 'dry-run',
      years: { from: 2024, to: 2025 },
      resume: {
        afterUid: 400,
        nextAfterUid: 456,
        skippedBeforeCursor: 7,
        blockedByFailure: true,
      },
      totals: {
        candidateMessages: 5,
        candidateSources: 6,
        successfulClassifications: 3,
        needsReview: 1,
        failures: 1,
        skippedByLimit: 2,
      },
    })
  })
})
