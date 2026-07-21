import { sql, type SQL } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { db } from '@/lib/db'

export const APPEARANCE_COUNT_RULE_VERSION = 'ajka-a-priority-2024-v1'

export type AppearanceCountGrade = 'A' | 'B' | 'C' | 'D' | 'E'
export type AppearanceCountMissingReason =
  | 'unknown_competition_category'
  | 'unknown_grade_scope'
  | 'missing_confirmed_roster'
  | 'missing_actual_result'

export interface AppearanceCountInput {
  /** Exactly one of playerIds and userIds must be supplied. */
  playerIds?: number[]
  /** Exactly one of playerIds and userIds must be supplied. */
  userIds?: string[]
  /** The year in which the association year starts (April 1). */
  associationYear: number
  /** Asia/Tokyo calendar date, formatted YYYY-MM-DD. */
  referenceDate: string
}

export interface AppearanceCountMissingSource {
  editionId: number
  grade: AppearanceCountGrade | null
  reason: AppearanceCountMissingReason
}

export interface AppearanceCountResult {
  associationYear: number
  startDate: string
  endDate: string
  referenceDate: string
  ruleVersion: string
  completeness: 'complete' | 'incomplete'
  missing: AppearanceCountMissingSource[]
  playerCounts: Array<{ playerId: number; count: number }>
  memberCounts: Array<{ userId: string; count: number }>
}

type AppearanceCountsDb = Pick<NodePgDatabase<typeof schema>, 'execute'>

interface ValidatedInput {
  playerIds: number[]
  userIds: string[]
  associationYear: number
  referenceDate: string
  startDate: string
  endDate: string
  effectiveEndDate: string
}

interface QueryRow extends Record<string, unknown> {
  row_kind: 'player_count' | 'member_count' | 'missing'
  subject_id: string | null
  ordinal: number | null
  appearance_count: number | null
  edition_id: number | null
  grade: AppearanceCountGrade | null
  reason: AppearanceCountMissingReason | null
}

/**
 * Return the inclusive association-year boundary as Asia/Tokyo calendar dates.
 * DATE columns are compared as calendar values in SQL, avoiding server timezone
 * conversion at the April 1 boundary.
 */
export function getAssociationYearRange(associationYear: number): {
  startDate: string
  endDate: string
} {
  if (!Number.isInteger(associationYear) || associationYear < 1900 || associationYear > 9998) {
    throw new Error('協会年度は1900〜9998の整数で指定してください')
  }
  return {
    startDate: `${associationYear}-04-01`,
    endDate: `${associationYear + 1}-03-31`,
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function validateInput(input: AppearanceCountInput): ValidatedInput {
  const hasPlayers = input.playerIds !== undefined
  const hasUsers = input.userIds !== undefined
  if (hasPlayers === hasUsers) {
    throw new Error('playerIds または userIds のどちらか一方だけを指定してください')
  }

  const playerIds = [...new Set(input.playerIds ?? [])]
  const userIds = [...new Set(input.userIds ?? [])]
  if (playerIds.length === 0 && userIds.length === 0) {
    throw new Error('playerIds または userIds を1件以上指定してください')
  }
  if (playerIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
    throw new Error('playerIdsには正の32bit整数を指定してください')
  }
  if (userIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    throw new Error('userIdsには空でないIDを指定してください')
  }
  if (!isCalendarDate(input.referenceDate)) {
    throw new Error('基準日はYYYY-MM-DD形式の有効な日付で指定してください')
  }

  const { startDate, endDate } = getAssociationYearRange(input.associationYear)
  return {
    playerIds,
    userIds,
    associationYear: input.associationYear,
    referenceDate: input.referenceDate,
    startDate,
    endDate,
    effectiveEndDate: input.referenceDate < endDate ? input.referenceDate : endDate,
  }
}

function requestedPlayerSql(ids: number[]): SQL {
  if (ids.length === 0) {
    return sql`SELECT NULL::integer AS player_id, NULL::integer AS ordinal WHERE false`
  }
  return sql`VALUES ${sql.join(
    ids.map((id, ordinal) => sql`(${id}::integer, ${ordinal}::integer)`),
    sql`, `,
  )}`
}

function requestedUserSql(ids: string[]): SQL {
  if (ids.length === 0) {
    return sql`SELECT NULL::text AS user_id, NULL::integer AS ordinal WHERE false`
  }
  return sql`VALUES ${sql.join(
    ids.map((id, ordinal) => sql`(${id}::text, ${ordinal}::integer)`),
    sql`, `,
  )}`
}

/**
 * Build the single set-based query used by getAppearanceCounts. Exported so a
 * focused DB test can EXPLAIN the exact production query and guard index use.
 */
export function buildAppearanceCountsQuery(input: AppearanceCountInput): SQL {
  const validated = validateInput(input)
  const requestedPlayers = requestedPlayerSql(validated.playerIds)
  const requestedUsers = requestedUserSql(validated.userIds)

  return sql`
    WITH
    requested_players(player_id, ordinal) AS (${requestedPlayers}),
    requested_users(user_id, ordinal) AS (${requestedUsers}),
    edition_dates AS (
      SELECT e.id AS edition_id,
             e.status,
             e.competition_category,
             COALESCE(MIN(ev.event_date), MIN(t.event_date)) AS event_date
      FROM tournament_series_editions e
      LEFT JOIN events ev ON ev.edition_id = e.id
      LEFT JOIN tournaments t ON t.edition_id = e.id
      GROUP BY e.id
    ),
    candidate_editions AS (
      SELECT edition_id, status, competition_category, event_date
      FROM edition_dates
      WHERE event_date >= ${validated.startDate}::date
        AND event_date <= ${validated.endDate}::date
    ),
    active_facts AS (
      SELECT f.edition_id, f.grade, f.actual_result_class_id
      FROM tournament_edition_grade_lottery_facts f
      JOIN candidate_editions ce ON ce.edition_id = f.edition_id
      WHERE f.valid_to IS NULL
    ),
    eligible_publications AS (
      SELECT publication.id,
             publication.edition_id,
             publication.grade,
             publication.roster_id
      FROM tournament_confirmed_roster_publications publication
      JOIN candidate_editions ce ON ce.edition_id = publication.edition_id
      JOIN tournament_entry_rosters roster ON roster.id = publication.roster_id
      JOIN events roster_event
        ON roster_event.id = roster.event_id
       AND roster_event.edition_id = publication.edition_id
      WHERE publication.published_at <= ${validated.referenceDate}::date
        AND roster.superseded_at IS NULL
    ),
    expected_grades AS (
      SELECT DISTINCT ce.edition_id, expected.grade
      FROM candidate_editions ce
      JOIN events expected_event ON expected_event.edition_id = ce.edition_id
      CROSS JOIN LATERAL unnest(expected_event.eligible_grades) AS expected(grade)
    ),
    eligible_actual_classes AS (
      SELECT fact.edition_id, fact.grade, class.id AS class_id
      FROM active_facts fact
      JOIN tournament_classes class ON class.id = fact.actual_result_class_id
      JOIN tournaments tournament
        ON tournament.id = class.tournament_id
       AND tournament.edition_id = fact.edition_id
      WHERE tournament.event_date >= ${validated.startDate}::date
        AND tournament.event_date <= ${validated.effectiveEndDate}::date
    ),
    grade_scope AS (
      SELECT ce.edition_id, expected.grade
      FROM candidate_editions ce
      JOIN expected_grades expected ON expected.edition_id = ce.edition_id
      UNION ALL
      SELECT ce.edition_id, NULL::grade
      FROM candidate_editions ce
      WHERE NOT EXISTS (
        SELECT 1 FROM expected_grades expected WHERE expected.edition_id = ce.edition_id
      )
    ),
    roster_appearances AS (
      SELECT DISTINCT publication.edition_id,
             entry.player_id,
             COALESCE(entry.user_id, player.user_id) AS user_id
      FROM eligible_publications publication
      JOIN candidate_editions ce ON ce.edition_id = publication.edition_id
      JOIN tournament_entry_roster_entries entry
        ON entry.roster_id = publication.roster_id
       AND entry.grade = publication.grade
      LEFT JOIN players player ON player.id = entry.player_id
      WHERE ce.competition_category IN ('official', 'new_year')
        AND (
          entry.status = 'carried_up'
          OR (
            entry.status IN ('applied', 'confirmed', 'cancelled')
            AND entry.selection_outcome IN ('accepted', 'unknown')
          )
        )
        AND entry.selection_outcome <> 'rejected'
        AND (
          EXISTS (
            SELECT 1 FROM requested_players requested
            WHERE requested.player_id = entry.player_id
          )
          OR EXISTS (
            SELECT 1 FROM requested_users requested
            WHERE requested.user_id = COALESCE(entry.user_id, player.user_id)
          )
        )
    ),
    actual_appearances AS (
      SELECT DISTINCT fact.edition_id,
             participant.player_id,
             player.user_id
      FROM eligible_actual_classes fact
      JOIN candidate_editions ce ON ce.edition_id = fact.edition_id
      JOIN tournament_participants participant ON participant.class_id = fact.class_id
      LEFT JOIN players player ON player.id = participant.player_id
      WHERE ce.competition_category IN ('official', 'new_year')
        AND (
          EXISTS (
            SELECT 1 FROM requested_players requested
            WHERE requested.player_id = participant.player_id
          )
          OR EXISTS (
            SELECT 1 FROM requested_users requested
            WHERE requested.user_id = player.user_id
          )
        )
    ),
    appearances AS (
      SELECT edition_id, player_id, user_id FROM roster_appearances
      UNION
      SELECT edition_id, player_id, user_id FROM actual_appearances
    ),
    missing AS (
      SELECT scope.edition_id,
             scope.grade,
             'unknown_competition_category'::text AS reason
      FROM grade_scope scope
      JOIN candidate_editions ce ON ce.edition_id = scope.edition_id
      WHERE ce.competition_category = 'unknown'
        AND (
          ce.event_date <= ${validated.effectiveEndDate}::date
          OR EXISTS (
            SELECT 1 FROM eligible_publications publication
            WHERE publication.edition_id = scope.edition_id
          )
          OR EXISTS (
            SELECT 1 FROM eligible_actual_classes actual
            WHERE actual.edition_id = scope.edition_id
          )
        )

      UNION ALL

      SELECT scope.edition_id,
             scope.grade,
             'unknown_grade_scope'::text AS reason
      FROM grade_scope scope
      JOIN candidate_editions ce ON ce.edition_id = scope.edition_id
      WHERE scope.grade IS NULL
        AND ce.competition_category IN ('official', 'new_year')
        AND (
          ce.event_date <= ${validated.effectiveEndDate}::date
          OR EXISTS (
            SELECT 1 FROM eligible_publications publication
            WHERE publication.edition_id = scope.edition_id
          )
          OR EXISTS (
            SELECT 1 FROM eligible_actual_classes actual
            WHERE actual.edition_id = scope.edition_id
          )
        )

      UNION ALL

      SELECT scope.edition_id,
             scope.grade,
             'missing_confirmed_roster'::text AS reason
      FROM grade_scope scope
      JOIN candidate_editions ce ON ce.edition_id = scope.edition_id
      WHERE ce.competition_category IN ('official', 'new_year')
        AND scope.grade IS NOT NULL
        AND ce.event_date <= ${validated.effectiveEndDate}::date
        AND NOT EXISTS (
          SELECT 1
          FROM eligible_publications publication
          WHERE publication.edition_id = scope.edition_id
            AND publication.grade IS NOT DISTINCT FROM scope.grade
        )

      UNION ALL

      SELECT scope.edition_id,
             scope.grade,
             'missing_actual_result'::text AS reason
      FROM grade_scope scope
      JOIN candidate_editions ce ON ce.edition_id = scope.edition_id
      WHERE ce.competition_category IN ('official', 'new_year')
        AND scope.grade IS NOT NULL
        AND ce.status = 'held'
        AND ce.event_date <= ${validated.effectiveEndDate}::date
        AND NOT EXISTS (
          SELECT 1
          FROM eligible_actual_classes fact
          WHERE fact.edition_id = scope.edition_id
            AND fact.grade IS NOT DISTINCT FROM scope.grade
        )
    ),
    player_counts AS (
      SELECT requested.player_id,
             requested.ordinal,
             COUNT(DISTINCT appearance.edition_id)::integer AS appearance_count
      FROM requested_players requested
      LEFT JOIN appearances appearance ON appearance.player_id = requested.player_id
      GROUP BY requested.player_id, requested.ordinal
    ),
    member_counts AS (
      SELECT requested.user_id,
             requested.ordinal,
             COUNT(DISTINCT appearance.edition_id)::integer AS appearance_count
      FROM requested_users requested
      LEFT JOIN appearances appearance ON appearance.user_id = requested.user_id
      GROUP BY requested.user_id, requested.ordinal
    )
    SELECT 'player_count'::text AS row_kind,
           player_id::text AS subject_id,
           ordinal,
           appearance_count,
           NULL::integer AS edition_id,
           NULL::grade AS grade,
           NULL::text AS reason
    FROM player_counts

    UNION ALL

    SELECT 'member_count'::text AS row_kind,
           user_id AS subject_id,
           ordinal,
           appearance_count,
           NULL::integer AS edition_id,
           NULL::grade AS grade,
           NULL::text AS reason
    FROM member_counts

    UNION ALL

    SELECT 'missing'::text AS row_kind,
           NULL::text AS subject_id,
           NULL::integer AS ordinal,
           NULL::integer AS appearance_count,
           edition_id,
           grade,
           reason
    FROM missing
    ORDER BY row_kind, ordinal NULLS LAST, edition_id NULLS LAST, grade NULLS LAST, reason NULLS LAST
  `
}

/**
 * Count confirmed or actual appearances for a batch of selected players or
 * members. The result is derived from source facts on every call, so roster and
 * result corrections take effect without a persisted aggregate or refresh job.
 */
export async function getAppearanceCounts(
  input: AppearanceCountInput,
  database: AppearanceCountsDb = db,
): Promise<AppearanceCountResult> {
  const validated = validateInput(input)
  const result = await database.execute(buildAppearanceCountsQuery(input))
  const rows = result.rows as QueryRow[]

  const playerCounts = rows
    .filter((row) => row.row_kind === 'player_count')
    .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
    .map((row) => ({
      playerId: Number(row.subject_id),
      count: Number(row.appearance_count ?? 0),
    }))
  const memberCounts = rows
    .filter((row) => row.row_kind === 'member_count')
    .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
    .map((row) => ({
      userId: String(row.subject_id),
      count: Number(row.appearance_count ?? 0),
    }))
  const missing = rows
    .filter((row) => row.row_kind === 'missing')
    .map((row) => ({
      editionId: Number(row.edition_id),
      grade: row.grade,
      reason: row.reason!,
    }))

  return {
    associationYear: validated.associationYear,
    startDate: validated.startDate,
    endDate: validated.endDate,
    referenceDate: validated.referenceDate,
    ruleVersion: APPEARANCE_COUNT_RULE_VERSION,
    completeness: missing.length === 0 ? 'complete' : 'incomplete',
    missing,
    playerCounts,
    memberCounts,
  }
}
