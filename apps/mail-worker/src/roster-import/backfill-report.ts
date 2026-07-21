export const LOTTERY_BACKFILL_REPORT_VERSION = 1 as const

export interface LotteryBackfillSummary {
  fetched: number
  failed: number
  rosterCandidateMessages: number
  rosterCandidateAttachments: number
  rosterCandidateBodies: number
  rosterCandidatesSelected: number
  rosterCandidatesSkippedByLimit: number
  rosterAiEligible: number
  rosterSourcesSelected: number
  rosterSourcesClassified: number
  rosterSourcesNeedReview: number
  rosterDraftsCreated: number
  rosterDraftsReused: number
  rosterDraftsFailed: number
  skippedByResumeCursor: number
  nextResumeCursor: number | null
  resumeCursorBlockedByFailure: boolean
}

export interface LotteryBackfillReport {
  schemaVersion: typeof LOTTERY_BACKFILL_REPORT_VERSION
  mode: 'dry-run' | 'write'
  mailbox: string
  years: { from: number | null; to: number | null }
  limits: { candidates: number; aiCalls: number }
  resume: {
    afterUid: number | null
    nextAfterUid: number | null
    skippedBeforeCursor: number
    blockedByFailure: boolean
  }
  totals: {
    fetched: number
    candidateMessages: number
    candidateSources: number
    selectedMessages: number
    selectedSources: number
    successfulClassifications: number
    needsReview: number
    draftsCreated: number
    draftsReused: number
    draftFailures: number
    failures: number
    skippedByLimit: number
    aiEligible: number
  }
}

/**
 * Stable operator-facing report for a mailbox × year backfill batch.
 * "successfulClassifications" means deterministic grade + roster-type metadata
 * was inferred; it never means the draft was approved or published.
 */
export function buildLotteryBackfillReport(
  summary: LotteryBackfillSummary,
  options: {
    dryRun: boolean
    mailbox: string
    fromYear?: number
    toYear?: number
    maxCandidates: number
    maxAiCalls: number
    resumeAfterUid?: number
  },
): LotteryBackfillReport {
  return {
    schemaVersion: LOTTERY_BACKFILL_REPORT_VERSION,
    mode: options.dryRun ? 'dry-run' : 'write',
    mailbox: options.mailbox,
    years: { from: options.fromYear ?? null, to: options.toYear ?? null },
    limits: { candidates: options.maxCandidates, aiCalls: options.maxAiCalls },
    resume: {
      afterUid: options.resumeAfterUid ?? null,
      nextAfterUid: summary.nextResumeCursor,
      skippedBeforeCursor: summary.skippedByResumeCursor,
      blockedByFailure: summary.resumeCursorBlockedByFailure,
    },
    totals: {
      fetched: summary.fetched,
      candidateMessages: summary.rosterCandidateMessages,
      candidateSources: summary.rosterCandidateAttachments + summary.rosterCandidateBodies,
      selectedMessages: summary.rosterCandidatesSelected,
      selectedSources: summary.rosterSourcesSelected,
      successfulClassifications: summary.rosterSourcesClassified,
      needsReview: summary.rosterSourcesNeedReview,
      draftsCreated: summary.rosterDraftsCreated,
      draftsReused: summary.rosterDraftsReused,
      draftFailures: summary.rosterDraftsFailed,
      failures: summary.failed + summary.rosterDraftsFailed,
      skippedByLimit: summary.rosterCandidatesSkippedByLimit,
      aiEligible: summary.rosterAiEligible,
    },
  }
}
