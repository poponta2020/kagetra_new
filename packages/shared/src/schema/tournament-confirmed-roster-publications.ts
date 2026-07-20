import { foreignKey, index, integer, pgTable, timestamp, unique } from 'drizzle-orm/pg-core'
import { date } from 'drizzle-orm/pg-core'
import { gradeEnum } from './enums'
import { tournamentSeriesEditions } from './tournament-series-editions'
import { tournamentEntryRosters } from './tournament-entry-rosters'

/**
 * An edition/grade roster publication that contributes to appearance counts.
 * Multiple publications may coexist because later carry-up announcements can
 * add members without replacing the original lottery-time roster.
 */
export const tournamentConfirmedRosterPublications = pgTable(
  'tournament_confirmed_roster_publications',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    editionId: integer('edition_id').notNull(),
    grade: gradeEnum('grade').notNull(),
    // Nullable so deleting a source roster preserves the publication audit row;
    // consumers report the missing source as incomplete.
    rosterId: integer('roster_id'),
    publishedAt: date('published_at', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('tcrp_edition_grade_roster_uq').on(
      table.editionId,
      table.grade,
      table.rosterId,
    ),
    index('tcrp_edition_grade_published_idx').on(
      table.editionId,
      table.grade,
      table.publishedAt,
    ),
    foreignKey({
      columns: [table.editionId],
      foreignColumns: [tournamentSeriesEditions.id],
      name: 'tcrp_edition_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.rosterId],
      foreignColumns: [tournamentEntryRosters.id],
      name: 'tcrp_roster_fk',
    }).onDelete('set null'),
  ],
)
