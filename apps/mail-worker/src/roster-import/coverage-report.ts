import { sql } from 'drizzle-orm'
import type { DbClient } from '../db.js'

export interface LotteryCoverageYear {
  /** Association year: April 1 through the following March 31. */
  year: number
  editions: number
  unknownCategory: number
  missingReferenceDate: number
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
    ), publication AS (
      SELECT edition_id, bool_or(roster_id IS NOT NULL) AS has_confirmed_roster
      FROM tournament_confirmed_roster_publications
      GROUP BY edition_id
    ), active_fact AS (
      SELECT edition_id, bool_or(actual_result_class_id IS NOT NULL) AS has_actual_result
      FROM tournament_edition_grade_lottery_facts
      WHERE valid_to IS NULL
      GROUP BY edition_id
    )
    SELECT e.association_year AS year,
      count(*)::int AS editions,
      count(*) FILTER (WHERE e.competition_category = 'unknown')::int AS unknown_category,
      count(*) FILTER (WHERE e.reference_date IS NULL)::int AS missing_reference_date,
      count(*) FILTER (
        WHERE e.status = 'held' AND e.competition_category IN ('official', 'new_year')
      )::int AS eligible_held_editions,
      count(*) FILTER (
        WHERE e.status = 'held'
          AND e.competition_category IN ('official', 'new_year')
          AND coalesce(p.has_confirmed_roster, false)
      )::int AS with_confirmed_roster,
      count(*) FILTER (
        WHERE e.status = 'held'
          AND e.competition_category IN ('official', 'new_year')
          AND coalesce(f.has_actual_result, false)
      )::int AS with_actual_result
    FROM edition_scope e
    LEFT JOIN publication p ON p.edition_id = e.id
    LEFT JOIN active_fact f ON f.edition_id = e.id
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
      && totals.missingConfirmedRoster === 0
      && totals.missingActualResult === 0,
    totals,
    byYear,
  }
}
