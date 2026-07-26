import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { APPEARANCE_COUNT_RULE_VERSION } from './appearance-counts'

export type LotteryMetricGrade = 'A' | 'B' | 'C' | 'D' | 'E'
export type LotterySelectionStatus = 'lottery' | 'under_capacity' | 'no_capacity' | 'unknown'

export type LotteryMetricMissingReason =
  | 'unknown_selection_status'
  | 'missing_applicant_roster'
  | 'invalid_applicant_roster'
  | 'duplicate_applicant_entries'
  | 'empty_applicant_roster'
  | 'invalid_under_capacity_count'
  | 'missing_selection_result_roster'
  | 'invalid_selection_result_roster'
  | 'duplicate_selection_result_entries'
  | 'empty_accepted_selection_result'
  | 'unknown_selection_outcome'

export type AGradeCutoffMissingReason =
  | 'invalid_adopted_input'
  | 'missing_capacity'
  | 'missing_application_start_date'
  | 'unsupported_rule_version'
  | 'missing_rule_evidence'
  | 'unverified_exemption_classification'
  | 'missing_applicant_identity'
  | 'duplicate_applicant_identity'
  | 'missing_selection_outcome'
  | 'duplicate_selection_outcome'
  | 'unknown_selection_outcome'
  | 'incomplete_appearance_history'

export interface CountRatio {
  numerator: number
  denominator: number
  formatted: string
}

export interface OccupancyRatio extends CountRatio {
  percentage: number
}

export interface AGradeOutcomeAggregate {
  applicantCount: number
  acceptedCount: number
  waitlistedCount: number
  rejectedCount: number
}

export interface AGradeAppearanceBucket extends AGradeOutcomeAggregate {
  appearanceCount: number
}

export interface AGradeCapacityLine {
  capacity: number
  /** null means the line falls between bands or outside the applicant stack. */
  boundaryAppearanceCount: number | null
  applicantsBeforeBoundary: number | null
  applicantsInBoundary: number | null
  acceptedInBoundary: number | null
  waitlistedInBoundary: number | null
  rejectedInBoundary: number | null
  remainingSlots: number
}

export interface AGradeCutoffAggregate {
  completeness: 'complete' | 'incomplete'
  missingReasons: AGradeCutoffMissingReason[]
  associationYear: number | null
  referenceDate: string | null
  ruleVersion: string | null
  organizerSlots: AGradeOutcomeAggregate
  appearanceBuckets: AGradeAppearanceBucket[]
  capacityLine: AGradeCapacityLine | null
}

export interface SeriesGradeLotteryMetric {
  editionId: number
  editionNumber: number
  year: number | null
  grade: LotteryMetricGrade
  selectionStatus: LotterySelectionStatus
  completeness: 'complete' | 'incomplete'
  missingReasons: LotteryMetricMissingReason[]
  applicantCount: number | null
  acceptedCount: number | null
  waitlistedCount: number | null
  rejectedCount: number | null
  unresolvedCount: number | null
  capacity: number | null
  lotteryRatio: CountRatio | null
  remainingSlots: number | null
  occupancy: OccupancyRatio | null
  aGradeCutoff: AGradeCutoffAggregate | null
}

export interface SeriesLotteryMetrics {
  points: SeriesGradeLotteryMetric[]
}

type MetricsDb = Pick<NodePgDatabase<typeof schema>, 'execute'>

interface CoreRow extends Record<string, unknown> {
  edition_id: number
  edition_number: number
  year: number | null
  grade: LotteryMetricGrade
  selection_status: LotterySelectionStatus
  capacity: number | null
  application_start_date: string | null
  selection_rule_version: string | null
  selection_rule_evidence: string | null
  verified_at: Date | null
  verified_by_user_id: string | null
  applicant_roster_id: number | null
  applicant_roster_type: string | null
  applicant_superseded_at: Date | null
  applicant_event_matches: boolean
  applicant_count: number
  applicant_distinct_count: number
  applicant_null_player_count: number
  selection_roster_id: number | null
  selection_roster_type: string | null
  selection_superseded_at: Date | null
  selection_event_matches: boolean
  selection_count: number
  selection_distinct_count: number
  accepted_count: number
  waitlisted_count: number
  rejected_count: number
  unknown_count: number
}

interface CutoffRow extends Record<string, unknown> {
  row_kind: 'subject' | 'missing'
  target_edition_id: number
  player_id: number | null
  selection_exempt: boolean | null
  appearance_count: number | null
  selection_match_count: number | null
  accepted_count: number | null
  waitlisted_count: number | null
  rejected_count: number | null
  unknown_count: number | null
  reason: string | null
}

const int = (value: unknown): number => Number(value ?? 0)
const intOrNull = (value: unknown): number | null => value == null ? null : Number(value)

function coreQuery(seriesId: number) {
  return sql`
    WITH scoped_facts AS (
      SELECT f.*, e.edition_number, e.year
      FROM tournament_edition_grade_lottery_facts f
      JOIN tournament_series_editions e ON e.id = f.edition_id
      WHERE e.series_id = ${seriesId}
        AND f.valid_to IS NULL
    )
    SELECT f.edition_id,
           f.edition_number,
           f.year,
           f.grade,
           f.selection_status,
           f.capacity,
           f.application_start_date,
           f.selection_rule_version,
           f.selection_rule_evidence,
           f.verified_at,
           f.verified_by_user_id,
           ar.id AS applicant_roster_id,
           ar.roster_type AS applicant_roster_type,
           ar.superseded_at AS applicant_superseded_at,
           -- entry-groups タスク8: 名簿の帰属は event → entry_group。ここでの整合性
           -- チェックは「この名簿のグループに、この edition を指す event が存在するか」
           -- の boolean（edition_id を非正規化コピーしない。approveDraftUnits の
           -- 後付け紐付けで stale になるため）。
           EXISTS (
             SELECT 1 FROM events aev
             WHERE aev.entry_group_id = ar.entry_group_id
               AND aev.edition_id = f.edition_id
           ) AS applicant_event_matches,
           COALESCE(app.count, 0)::integer AS applicant_count,
           COALESCE(app.distinct_count, 0)::integer AS applicant_distinct_count,
           COALESCE(app.null_player_count, 0)::integer AS applicant_null_player_count,
           sr.id AS selection_roster_id,
           sr.roster_type AS selection_roster_type,
           sr.superseded_at AS selection_superseded_at,
           EXISTS (
             SELECT 1 FROM events sev
             WHERE sev.entry_group_id = sr.entry_group_id
               AND sev.edition_id = f.edition_id
           ) AS selection_event_matches,
           COALESCE(sel.count, 0)::integer AS selection_count,
           COALESCE(sel.distinct_count, 0)::integer AS selection_distinct_count,
           COALESCE(sel.accepted_count, 0)::integer AS accepted_count,
           COALESCE(sel.waitlisted_count, 0)::integer AS waitlisted_count,
           COALESCE(sel.rejected_count, 0)::integer AS rejected_count,
           COALESCE(sel.unknown_count, 0)::integer AS unknown_count
    FROM scoped_facts f
    LEFT JOIN tournament_entry_rosters ar ON ar.id = f.applicant_roster_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS count,
             COUNT(DISTINCT COALESCE(
               entry.player_id::text,
               regexp_replace(lower(entry.raw_name), '[[:space:]　]+', '', 'g')
             ))::integer AS distinct_count,
             COUNT(*) FILTER (WHERE entry.player_id IS NULL)::integer AS null_player_count
      FROM tournament_entry_roster_entries entry
      WHERE entry.roster_id = f.applicant_roster_id
        AND entry.grade = f.grade
    ) app ON true
    LEFT JOIN tournament_entry_rosters sr ON sr.id = f.selection_result_roster_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS count,
             COUNT(DISTINCT COALESCE(
               entry.player_id::text,
               regexp_replace(lower(entry.raw_name), '[[:space:]　]+', '', 'g')
             ))::integer AS distinct_count,
             COUNT(*) FILTER (WHERE entry.selection_outcome = 'accepted')::integer AS accepted_count,
             COUNT(*) FILTER (WHERE entry.selection_outcome = 'waitlisted')::integer AS waitlisted_count,
             COUNT(*) FILTER (WHERE entry.selection_outcome = 'rejected')::integer AS rejected_count,
             COUNT(*) FILTER (WHERE entry.selection_outcome = 'unknown')::integer AS unknown_count
      FROM tournament_entry_roster_entries entry
      WHERE entry.roster_id = f.selection_result_roster_id
        AND entry.grade = f.grade
    ) sel ON true
    ORDER BY f.edition_number, f.grade
  `
}

/**
 * One set query for every A-grade target. It mirrors appearance-counts.ts, but
 * carries each target's own association year and reference date in the CTEs.
 */
function cutoffQuery(seriesId: number) {
  return sql`
    WITH
    targets AS (
      SELECT f.edition_id AS target_edition_id,
             f.applicant_roster_id,
             f.selection_result_roster_id,
             f.application_start_date,
             (f.application_start_date - 1)::date AS reference_date,
             CASE
               WHEN EXTRACT(MONTH FROM (f.application_start_date - 1)) >= 4
                 THEN EXTRACT(YEAR FROM (f.application_start_date - 1))::integer
               ELSE EXTRACT(YEAR FROM (f.application_start_date - 1))::integer - 1
             END AS association_year
      FROM tournament_edition_grade_lottery_facts f
      JOIN tournament_series_editions target_edition ON target_edition.id = f.edition_id
      WHERE target_edition.series_id = ${seriesId}
        AND f.grade = 'A'
        AND f.valid_to IS NULL
        AND f.application_start_date IS NOT NULL
    ),
    target_applicants AS (
      SELECT target.target_edition_id,
             entry.id AS applicant_entry_id,
             entry.player_id,
             entry.selection_exempt
      FROM targets target
      JOIN tournament_entry_roster_entries entry
        ON entry.roster_id = target.applicant_roster_id
       AND entry.grade = 'A'
    ),
    selection_matches AS (
      SELECT applicant.target_edition_id,
             applicant.applicant_entry_id,
             COUNT(selection.id)::integer AS selection_match_count,
             COUNT(selection.id) FILTER (WHERE selection.selection_outcome = 'accepted')::integer AS accepted_count,
             COUNT(selection.id) FILTER (WHERE selection.selection_outcome = 'waitlisted')::integer AS waitlisted_count,
             COUNT(selection.id) FILTER (WHERE selection.selection_outcome = 'rejected')::integer AS rejected_count,
             COUNT(selection.id) FILTER (WHERE selection.selection_outcome = 'unknown')::integer AS unknown_count
      FROM target_applicants applicant
      JOIN targets target ON target.target_edition_id = applicant.target_edition_id
      LEFT JOIN tournament_entry_roster_entries selection
        ON selection.roster_id = target.selection_result_roster_id
       AND selection.grade = 'A'
       AND selection.player_id = applicant.player_id
       AND applicant.player_id IS NOT NULL
      GROUP BY applicant.target_edition_id, applicant.applicant_entry_id
    ),
    edition_dates AS (
      SELECT edition.id AS edition_id,
             edition.status,
             edition.competition_category,
             COALESCE(MIN(event.event_date), MIN(tournament.event_date)) AS event_date
      FROM tournament_series_editions edition
      LEFT JOIN events event ON event.edition_id = edition.id
      LEFT JOIN tournaments tournament ON tournament.edition_id = edition.id
      GROUP BY edition.id
    ),
    candidate_editions AS (
      SELECT target.target_edition_id,
             target.reference_date,
             dates.*
      FROM targets target
      JOIN edition_dates dates
        ON dates.event_date >= make_date(target.association_year, 4, 1)
       AND dates.event_date <= make_date(target.association_year + 1, 3, 31)
    ),
    active_facts AS (
      SELECT candidate.target_edition_id,
             fact.edition_id,
             fact.grade,
             fact.actual_result_class_id
      FROM candidate_editions candidate
      JOIN tournament_edition_grade_lottery_facts fact
        ON fact.edition_id = candidate.edition_id
       AND fact.valid_to IS NULL
    ),
    -- entry-groups タスク8: 名簿の帰属は event → entry_group。roster.event_id は
    -- 撤去されたので、旧 JOIN の代わりにグループ内に一致 event が存在するかを
    -- EXISTS で判定する（edition_id の非正規化はしない）。
    eligible_publications AS (
      SELECT candidate.target_edition_id,
             publication.id,
             publication.edition_id,
             publication.grade,
             publication.roster_id
      FROM candidate_editions candidate
      JOIN tournament_confirmed_roster_publications publication
        ON publication.edition_id = candidate.edition_id
       AND publication.published_at <= candidate.reference_date
      JOIN tournament_entry_rosters roster
        ON roster.id = publication.roster_id
       AND roster.superseded_at IS NULL
      WHERE EXISTS (
        SELECT 1 FROM events roster_event
        WHERE roster_event.entry_group_id = roster.entry_group_id
          AND roster_event.edition_id = publication.edition_id
      )
    ),
    expected_grades AS (
      SELECT DISTINCT candidate.target_edition_id,
             candidate.edition_id,
             expected.grade
      FROM candidate_editions candidate
      JOIN events expected_event ON expected_event.edition_id = candidate.edition_id
      CROSS JOIN LATERAL unnest(expected_event.eligible_grades) AS expected(grade)
    ),
    eligible_actual_classes AS (
      SELECT fact.target_edition_id,
             fact.edition_id,
             fact.grade,
             class.id AS class_id
      FROM active_facts fact
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = fact.target_edition_id
       AND candidate.edition_id = fact.edition_id
      JOIN tournament_classes class ON class.id = fact.actual_result_class_id
      JOIN tournaments tournament
        ON tournament.id = class.tournament_id
       AND tournament.edition_id = fact.edition_id
       AND tournament.event_date <= candidate.reference_date
    ),
    grade_scope AS (
      SELECT candidate.target_edition_id, candidate.edition_id, expected.grade
      FROM candidate_editions candidate
      JOIN expected_grades expected
        ON expected.target_edition_id = candidate.target_edition_id
       AND expected.edition_id = candidate.edition_id
      UNION ALL
      SELECT candidate.target_edition_id, candidate.edition_id, NULL::grade
      FROM candidate_editions candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM expected_grades expected
        WHERE expected.target_edition_id = candidate.target_edition_id
          AND expected.edition_id = candidate.edition_id
      )
    ),
    roster_appearances AS (
      SELECT DISTINCT publication.target_edition_id,
             publication.edition_id,
             entry.player_id
      FROM eligible_publications publication
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = publication.target_edition_id
       AND candidate.edition_id = publication.edition_id
      JOIN tournament_entry_roster_entries entry
        ON entry.roster_id = publication.roster_id
       AND entry.grade = publication.grade
      JOIN target_applicants applicant
        ON applicant.target_edition_id = publication.target_edition_id
       AND applicant.player_id = entry.player_id
       AND applicant.player_id IS NOT NULL
      WHERE candidate.competition_category IN ('official', 'new_year')
        AND (
          entry.status = 'carried_up'
          OR (
            entry.status IN ('applied', 'confirmed', 'cancelled')
            AND entry.selection_outcome IN ('accepted', 'unknown')
          )
        )
        AND entry.selection_outcome <> 'rejected'
    ),
    actual_appearances AS (
      SELECT DISTINCT actual.target_edition_id,
             actual.edition_id,
             participant.player_id
      FROM eligible_actual_classes actual
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = actual.target_edition_id
       AND candidate.edition_id = actual.edition_id
      JOIN tournament_participants participant ON participant.class_id = actual.class_id
      JOIN target_applicants applicant
        ON applicant.target_edition_id = actual.target_edition_id
       AND applicant.player_id = participant.player_id
       AND applicant.player_id IS NOT NULL
      WHERE candidate.competition_category IN ('official', 'new_year')
    ),
    appearances AS (
      SELECT target_edition_id, edition_id, player_id FROM roster_appearances
      UNION
      SELECT target_edition_id, edition_id, player_id FROM actual_appearances
    ),
    missing AS (
      SELECT scope.target_edition_id,
             'unknown_competition_category'::text AS reason
      FROM grade_scope scope
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = scope.target_edition_id
       AND candidate.edition_id = scope.edition_id
      WHERE candidate.competition_category = 'unknown'
        AND (
          candidate.event_date <= candidate.reference_date
          OR EXISTS (
            SELECT 1 FROM eligible_publications publication
            WHERE publication.target_edition_id = scope.target_edition_id
              AND publication.edition_id = scope.edition_id
          )
          OR EXISTS (
            SELECT 1 FROM eligible_actual_classes actual
            WHERE actual.target_edition_id = scope.target_edition_id
              AND actual.edition_id = scope.edition_id
          )
        )
      UNION
      SELECT scope.target_edition_id, 'unknown_grade_scope'::text
      FROM grade_scope scope
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = scope.target_edition_id
       AND candidate.edition_id = scope.edition_id
      WHERE scope.grade IS NULL
        AND candidate.competition_category IN ('official', 'new_year')
        AND (
          candidate.event_date <= candidate.reference_date
          OR EXISTS (
            SELECT 1 FROM eligible_publications publication
            WHERE publication.target_edition_id = scope.target_edition_id
              AND publication.edition_id = scope.edition_id
          )
          OR EXISTS (
            SELECT 1 FROM eligible_actual_classes actual
            WHERE actual.target_edition_id = scope.target_edition_id
              AND actual.edition_id = scope.edition_id
          )
        )
      UNION
      SELECT scope.target_edition_id, 'missing_confirmed_roster'::text
      FROM grade_scope scope
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = scope.target_edition_id
       AND candidate.edition_id = scope.edition_id
      WHERE candidate.competition_category IN ('official', 'new_year')
        AND scope.grade IS NOT NULL
        AND candidate.event_date <= candidate.reference_date
        AND NOT EXISTS (
          SELECT 1 FROM eligible_publications publication
          WHERE publication.target_edition_id = scope.target_edition_id
            AND publication.edition_id = scope.edition_id
            AND publication.grade IS NOT DISTINCT FROM scope.grade
        )
      UNION
      SELECT scope.target_edition_id, 'missing_actual_result'::text
      FROM grade_scope scope
      JOIN candidate_editions candidate
        ON candidate.target_edition_id = scope.target_edition_id
       AND candidate.edition_id = scope.edition_id
      WHERE candidate.competition_category IN ('official', 'new_year')
        AND scope.grade IS NOT NULL
        AND candidate.status = 'held'
        AND candidate.event_date <= candidate.reference_date
        AND NOT EXISTS (
          SELECT 1 FROM eligible_actual_classes actual
          WHERE actual.target_edition_id = scope.target_edition_id
            AND actual.edition_id = scope.edition_id
            AND actual.grade IS NOT DISTINCT FROM scope.grade
        )
    ),
    subject_counts AS (
      SELECT applicant.target_edition_id,
             applicant.applicant_entry_id,
             applicant.player_id,
             applicant.selection_exempt,
             COUNT(DISTINCT appearance.edition_id)::integer AS appearance_count
      FROM target_applicants applicant
      LEFT JOIN appearances appearance
        ON appearance.target_edition_id = applicant.target_edition_id
       AND appearance.player_id = applicant.player_id
      GROUP BY applicant.target_edition_id,
               applicant.applicant_entry_id,
               applicant.player_id,
               applicant.selection_exempt
    )
    SELECT 'subject'::text AS row_kind,
           subject.target_edition_id,
           subject.player_id,
           subject.selection_exempt,
           subject.appearance_count,
           selection.selection_match_count,
           selection.accepted_count,
           selection.waitlisted_count,
           selection.rejected_count,
           selection.unknown_count,
           NULL::text AS reason
    FROM subject_counts subject
    JOIN selection_matches selection
      ON selection.target_edition_id = subject.target_edition_id
     AND selection.applicant_entry_id = subject.applicant_entry_id
    UNION ALL
    SELECT 'missing'::text,
           missing.target_edition_id,
           NULL::integer,
           NULL::boolean,
           NULL::integer,
           NULL::integer,
           NULL::integer,
           NULL::integer,
           NULL::integer,
           NULL::integer,
           missing.reason
    FROM missing
    ORDER BY target_edition_id, row_kind, appearance_count NULLS LAST, player_id NULLS LAST
  `
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function buildCoreMetric(row: CoreRow): SeriesGradeLotteryMetric {
  const reasons: LotteryMetricMissingReason[] = []
  const applicantId = intOrNull(row.applicant_roster_id)
  const applicantValid = applicantId !== null &&
    row.applicant_roster_type === 'applicant' &&
    row.applicant_superseded_at == null &&
    row.applicant_event_matches === true
  const selectionId = intOrNull(row.selection_roster_id)
  const selectionValid = selectionId !== null &&
    row.selection_roster_type === 'confirmed' &&
    row.selection_superseded_at == null &&
    row.selection_event_matches === true

  if (row.selection_status === 'unknown') reasons.push('unknown_selection_status')
  if (applicantId === null) reasons.push('missing_applicant_roster')
  else if (!applicantValid) reasons.push('invalid_applicant_roster')
  if (applicantValid && int(row.applicant_count) === 0) reasons.push('empty_applicant_roster')
  if (applicantValid && int(row.applicant_count) !== int(row.applicant_distinct_count)) {
    reasons.push('duplicate_applicant_entries')
  }
  if (
    applicantValid &&
    row.selection_status === 'under_capacity' &&
    row.capacity != null &&
    int(row.applicant_count) >= int(row.capacity)
  ) {
    reasons.push('invalid_under_capacity_count')
  }

  if (row.selection_status === 'lottery') {
    if (selectionId === null) reasons.push('missing_selection_result_roster')
    else if (!selectionValid) reasons.push('invalid_selection_result_roster')
    if (selectionValid && int(row.selection_count) !== int(row.selection_distinct_count)) {
      reasons.push('duplicate_selection_result_entries')
    }
    if (selectionValid && int(row.accepted_count) === 0) {
      reasons.push('empty_accepted_selection_result')
    }
    if (selectionValid && int(row.unknown_count) > 0) reasons.push('unknown_selection_outcome')
  }

  const applicantCount = applicantValid ? int(row.applicant_count) : null
  const hasSelectionCounts = row.selection_status === 'lottery' && selectionValid
  const acceptedCount = hasSelectionCounts ? int(row.accepted_count) : null
  const waitlistedCount = hasSelectionCounts ? int(row.waitlisted_count) : null
  const rejectedCount = hasSelectionCounts ? int(row.rejected_count) : null
  const unresolvedCount = hasSelectionCounts ? int(row.unknown_count) : null
  const coreComplete = reasons.length === 0
  const lotteryRatio = coreComplete && row.selection_status === 'lottery' &&
    applicantCount != null && acceptedCount != null && acceptedCount > 0
    ? {
        numerator: applicantCount,
        denominator: acceptedCount,
        formatted: (applicantCount / acceptedCount).toFixed(2),
      }
    : null
  const occupancy = coreComplete && row.selection_status === 'under_capacity' &&
    applicantCount != null && row.capacity != null
    ? {
        numerator: applicantCount,
        denominator: int(row.capacity),
        percentage: Math.round((applicantCount / int(row.capacity)) * 10000) / 100,
        formatted: `${Math.round((applicantCount / int(row.capacity)) * 10000) / 100}%`,
      }
    : null

  return {
    editionId: int(row.edition_id),
    editionNumber: int(row.edition_number),
    year: intOrNull(row.year),
    grade: row.grade,
    selectionStatus: row.selection_status,
    completeness: coreComplete ? 'complete' : 'incomplete',
    missingReasons: reasons,
    applicantCount,
    acceptedCount,
    waitlistedCount,
    rejectedCount,
    unresolvedCount,
    capacity: intOrNull(row.capacity),
    lotteryRatio,
    remainingSlots: occupancy == null ? null : Math.max(0, occupancy.denominator - occupancy.numerator),
    occupancy,
    aGradeCutoff: null,
  }
}

function outcomeAggregate(rows: CutoffRow[]): AGradeOutcomeAggregate {
  return rows.reduce<AGradeOutcomeAggregate>((aggregate, row) => ({
    applicantCount: aggregate.applicantCount + 1,
    acceptedCount: aggregate.acceptedCount + int(row.accepted_count),
    waitlistedCount: aggregate.waitlistedCount + int(row.waitlisted_count),
    rejectedCount: aggregate.rejectedCount + int(row.rejected_count),
  }), { applicantCount: 0, acceptedCount: 0, waitlistedCount: 0, rejectedCount: 0 })
}

function buildCutoff(
  core: CoreRow,
  subjects: CutoffRow[],
  missingHistory: boolean,
): AGradeCutoffAggregate {
  const reasons: AGradeCutoffMissingReason[] = []
  const applicantSourceValid = core.applicant_roster_id != null &&
    core.applicant_roster_type === 'applicant' &&
    core.applicant_superseded_at == null &&
    core.applicant_event_matches === true
  const selectionSourceValid = core.selection_roster_id != null &&
    core.selection_roster_type === 'confirmed' &&
    core.selection_superseded_at == null &&
    core.selection_event_matches === true
  if (!applicantSourceValid || (core.selection_status === 'lottery' && !selectionSourceValid)) {
    reasons.push('invalid_adopted_input')
  }
  if (core.capacity == null) reasons.push('missing_capacity')
  if (core.application_start_date == null) reasons.push('missing_application_start_date')
  if (core.selection_rule_version !== APPEARANCE_COUNT_RULE_VERSION) {
    reasons.push('unsupported_rule_version')
  }
  if (core.selection_rule_evidence == null) reasons.push('missing_rule_evidence')
  if (core.verified_at == null || core.verified_by_user_id == null) {
    reasons.push('unverified_exemption_classification')
  }
  if (int(core.applicant_null_player_count) > 0) reasons.push('missing_applicant_identity')
  if (int(core.applicant_count) !== int(core.applicant_distinct_count)) {
    reasons.push('duplicate_applicant_identity')
  }
  // Under-capacity editions intentionally have no selection-result roster.
  // Their capacity line is derived from the applicant stack alone; only an
  // actual lottery needs a one-to-one, resolved outcome for every applicant.
  if (core.selection_status === 'lottery') {
    if (subjects.some((row) => int(row.selection_match_count) === 0)) {
      reasons.push('missing_selection_outcome')
    }
    if (subjects.some((row) => int(row.selection_match_count) > 1)) {
      reasons.push('duplicate_selection_outcome')
    }
    if (subjects.some((row) => int(row.unknown_count) > 0)) {
      reasons.push('unknown_selection_outcome')
    }
  }
  if (missingHistory) reasons.push('incomplete_appearance_history')

  const organizerRows = subjects.filter((row) => row.selection_exempt === true)
  const normalRows = subjects.filter((row) => row.selection_exempt !== true)
  const organizerSlots = outcomeAggregate(organizerRows)
  const grouped = new Map<number, CutoffRow[]>()
  for (const row of normalRows) {
    const count = int(row.appearance_count)
    grouped.set(count, [...(grouped.get(count) ?? []), row])
  }
  const appearanceBuckets = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([appearanceCount, rows]) => ({ appearanceCount, ...outcomeAggregate(rows) }))

  let capacityLine: AGradeCapacityLine | null = null
  if (core.capacity != null) {
    const capacity = int(core.capacity)
    const total = subjects.length
    let cumulative = organizerSlots.applicantCount
    let boundary: AGradeAppearanceBucket | null = null
    let beforeBoundary: number | null = null
    for (const bucket of appearanceBuckets) {
      const after = cumulative + bucket.applicantCount
      if (cumulative < capacity && capacity < after) {
        boundary = bucket
        beforeBoundary = cumulative
        break
      }
      cumulative = after
    }
    capacityLine = {
      capacity,
      boundaryAppearanceCount: boundary?.appearanceCount ?? null,
      applicantsBeforeBoundary: beforeBoundary,
      applicantsInBoundary: boundary?.applicantCount ?? null,
      acceptedInBoundary: boundary?.acceptedCount ?? null,
      waitlistedInBoundary: boundary?.waitlistedCount ?? null,
      rejectedInBoundary: boundary?.rejectedCount ?? null,
      remainingSlots: Math.max(0, capacity - total),
    }
  }

  const applicationStartDate = core.application_start_date
  const referenceDate = applicationStartDate == null
    ? null
    : new Date(`${applicationStartDate}T00:00:00.000Z`).toISOString().slice(0, 10) === applicationStartDate
      ? new Date(new Date(`${applicationStartDate}T00:00:00.000Z`).getTime() - 86_400_000)
          .toISOString().slice(0, 10)
      : null
  const associationYear = referenceDate == null
    ? null
    : Number(referenceDate.slice(0, 4)) - (Number(referenceDate.slice(5, 7)) < 4 ? 1 : 0)

  const missingReasons = unique(reasons)
  if (missingReasons.length > 0 && capacityLine != null) {
    capacityLine = {
      ...capacityLine,
      boundaryAppearanceCount: null,
      applicantsBeforeBoundary: null,
      applicantsInBoundary: null,
      acceptedInBoundary: null,
      waitlistedInBoundary: null,
      rejectedInBoundary: null,
    }
  }

  return {
    completeness: missingReasons.length === 0 ? 'complete' : 'incomplete',
    missingReasons,
    associationYear,
    referenceDate,
    ruleVersion: core.selection_rule_version,
    organizerSlots,
    appearanceBuckets,
    capacityLine,
  }
}

/**
 * Return privacy-safe lottery metrics for one series. Query count is fixed at
 * two regardless of the number of editions or applicants.
 */
export async function getSeriesLotteryMetrics(
  seriesId: number,
  database: MetricsDb = db,
): Promise<SeriesLotteryMetrics> {
  if (!Number.isInteger(seriesId) || seriesId <= 0 || seriesId > 2_147_483_647) {
    return { points: [] }
  }

  const [coreResult, cutoffResult] = await Promise.all([
    database.execute(coreQuery(seriesId)),
    database.execute(cutoffQuery(seriesId)),
  ])
  const coreRows = coreResult.rows as CoreRow[]
  const cutoffRows = cutoffResult.rows as CutoffRow[]
  const cutoffByEdition = new Map<number, CutoffRow[]>()
  const incompleteHistory = new Set<number>()
  for (const row of cutoffRows) {
    const editionId = int(row.target_edition_id)
    if (row.row_kind === 'missing') incompleteHistory.add(editionId)
    else cutoffByEdition.set(editionId, [...(cutoffByEdition.get(editionId) ?? []), row])
  }

  return {
    points: coreRows.map((row) => {
      const metric = buildCoreMetric(row)
      if (row.grade === 'A') {
        metric.aGradeCutoff = buildCutoff(
          row,
          cutoffByEdition.get(metric.editionId) ?? [],
          incompleteHistory.has(metric.editionId),
        )
      }
      return metric
    }),
  }
}
