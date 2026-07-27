import { sql } from 'drizzle-orm'
import type { DbClient } from '../db.js'

export interface LotteryCoverageYear {
  /** Association year: April 1 through the following March 31. */
  year: number
  editions: number
  unknownCategory: number
  missingReferenceDate: number
  missingGradeScope: number
  eligibleHeldEditions: number
  withConfirmedRoster: number
  withActualResult: number
  missingConfirmedRoster: number
  missingActualResult: number
}

export interface LotteryCoverageReport {
  generatedAt: string
  years: { from: number; to: number | null }
  complete: boolean
  totals: Omit<LotteryCoverageYear, 'year'>
  byYear: LotteryCoverageYear[]
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Read-only coverage report. It never guesses unknown categories or sources. */
export async function getLotteryCoverageReport(
  db: DbClient,
  options: { fromYear?: number; toYear?: number; now?: Date } = {},
): Promise<LotteryCoverageReport> {
  const fromYear = options.fromYear ?? 2024
  const toYear = options.toYear
  const result = await db.execute(sql`
    WITH edition_date AS (
      SELECT source.edition_id, min(source.event_date) AS reference_date
      FROM (
        SELECT edition_id, event_date FROM events WHERE edition_id IS NOT NULL
        UNION ALL
        SELECT edition_id, event_date FROM tournaments WHERE edition_id IS NOT NULL
      ) source
      GROUP BY source.edition_id
    ), edition_scope AS (
      SELECT e.*,
        CASE
          WHEN d.reference_date IS NOT NULL
            THEN extract(year FROM (d.reference_date - interval '3 months'))::int
          ELSE e.year
        END AS association_year,
        d.reference_date
      FROM tournament_series_editions e
      LEFT JOIN edition_date d ON d.edition_id = e.id
    ), expected_grade AS (
      SELECT DISTINCT event.edition_id, expected.grade
      FROM events event
      CROSS JOIN LATERAL unnest(event.eligible_grades) AS expected(grade)
      WHERE event.edition_id IS NOT NULL
    ), publication AS (
      -- entry-groups タスク8: 名簿の帰属は event → entry_group へ移った。
      -- roster.event_id は撤去されたので、グループ内に一致 event が存在するかを
      -- EXISTS で判定する（edition_id の非正規化はしない）。
      SELECT DISTINCT publication.edition_id, publication.grade
      FROM tournament_confirmed_roster_publications publication
      JOIN tournament_entry_rosters roster ON roster.id = publication.roster_id
      WHERE roster.superseded_at IS NULL
        AND EXISTS (
          SELECT 1 FROM events roster_event
          WHERE roster_event.entry_group_id = roster.entry_group_id
            AND roster_event.edition_id = publication.edition_id
        )
    ), active_result AS (
      SELECT DISTINCT fact.edition_id, fact.grade
      FROM tournament_edition_grade_lottery_facts fact
      JOIN tournament_classes class ON class.id = fact.actual_result_class_id
      JOIN tournaments tournament
        ON tournament.id = class.tournament_id
       AND tournament.edition_id = fact.edition_id
      WHERE fact.valid_to IS NULL
    ), edition_coverage AS (
      SELECT e.id AS edition_id,
        count(expected.grade)::int AS expected_grades,
        count(expected.grade) FILTER (
          WHERE publication.grade IS NOT NULL
        )::int AS confirmed_grades,
        count(expected.grade) FILTER (
          WHERE active_result.grade IS NOT NULL
        )::int AS actual_result_grades
      FROM edition_scope e
      LEFT JOIN expected_grade expected ON expected.edition_id = e.id
      LEFT JOIN publication
        ON publication.edition_id = e.id
       AND publication.grade = expected.grade
      LEFT JOIN active_result
        ON active_result.edition_id = e.id
       AND active_result.grade = expected.grade
      GROUP BY e.id
    )
    SELECT e.association_year AS year,
      count(*)::int AS editions,
      count(*) FILTER (WHERE e.competition_category = 'unknown')::int AS unknown_category,
      count(*) FILTER (WHERE e.reference_date IS NULL)::int AS missing_reference_date,
      count(*) FILTER (
        WHERE e.status = 'held'
          AND e.competition_category IN ('official', 'new_year')
          AND coverage.expected_grades = 0
      )::int AS missing_grade_scope,
      count(*) FILTER (
        WHERE e.status = 'held' AND e.competition_category IN ('official', 'new_year')
      )::int AS eligible_held_editions,
      count(*) FILTER (
        WHERE e.status = 'held'
          AND e.competition_category IN ('official', 'new_year')
          AND coverage.expected_grades > 0
          AND coverage.confirmed_grades = coverage.expected_grades
      )::int AS with_confirmed_roster,
      count(*) FILTER (
        WHERE e.status = 'held'
          AND e.competition_category IN ('official', 'new_year')
          AND coverage.expected_grades > 0
          AND coverage.actual_result_grades = coverage.expected_grades
      )::int AS with_actual_result
    FROM edition_scope e
    JOIN edition_coverage coverage ON coverage.edition_id = e.id
    WHERE e.association_year >= ${fromYear}
      ${toYear === undefined ? sql`` : sql`AND e.association_year <= ${toYear}`}
    GROUP BY e.association_year
    ORDER BY e.association_year
  `)

  const byYear = (result.rows as Record<string, unknown>[]).map((row) => {
    const eligibleHeldEditions = count(row.eligible_held_editions)
    const withConfirmedRoster = count(row.with_confirmed_roster)
    const withActualResult = count(row.with_actual_result)
    return {
      year: count(row.year),
      editions: count(row.editions),
      unknownCategory: count(row.unknown_category),
      missingReferenceDate: count(row.missing_reference_date),
      missingGradeScope: count(row.missing_grade_scope),
      eligibleHeldEditions,
      withConfirmedRoster,
      withActualResult,
      missingConfirmedRoster: eligibleHeldEditions - withConfirmedRoster,
      missingActualResult: eligibleHeldEditions - withActualResult,
    }
  })
  const totals = byYear.reduce<Omit<LotteryCoverageYear, 'year'>>(
    (sum, row) => ({
      editions: sum.editions + row.editions,
      unknownCategory: sum.unknownCategory + row.unknownCategory,
      missingReferenceDate: sum.missingReferenceDate + row.missingReferenceDate,
      missingGradeScope: sum.missingGradeScope + row.missingGradeScope,
      eligibleHeldEditions: sum.eligibleHeldEditions + row.eligibleHeldEditions,
      withConfirmedRoster: sum.withConfirmedRoster + row.withConfirmedRoster,
      withActualResult: sum.withActualResult + row.withActualResult,
      missingConfirmedRoster: sum.missingConfirmedRoster + row.missingConfirmedRoster,
      missingActualResult: sum.missingActualResult + row.missingActualResult,
    }),
    {
      editions: 0,
      unknownCategory: 0,
      missingReferenceDate: 0,
      missingGradeScope: 0,
      eligibleHeldEditions: 0,
      withConfirmedRoster: 0,
      withActualResult: 0,
      missingConfirmedRoster: 0,
      missingActualResult: 0,
    },
  )

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    years: { from: fromYear, to: toYear ?? null },
    complete: totals.editions > 0
      && totals.unknownCategory === 0
      && totals.missingReferenceDate === 0
      && totals.missingGradeScope === 0
      && totals.missingConfirmedRoster === 0
      && totals.missingActualResult === 0,
    totals,
    byYear,
  }
}
