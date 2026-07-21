import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { gradeEnum, lotterySelectionStatusEnum } from './enums'
import { mailMessages } from './mail-messages'
import { tournamentClasses } from './tournament-classes'
import { tournamentEntryRosters } from './tournament-entry-rosters'
import { tournamentSeriesEditions } from './tournament-series-editions'
import { users } from './auth'

/** Active, versioned source selection for one edition and grade. */
export const tournamentEditionGradeLotteryFacts = pgTable(
  'tournament_edition_grade_lottery_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    editionId: integer('edition_id').notNull(),
    grade: gradeEnum('grade').notNull(),
    selectionStatus: lotterySelectionStatusEnum('selection_status')
      .notNull()
      .default('unknown'),
    capacity: integer('capacity'),
    applicationStartDate: date('application_start_date', { mode: 'string' }),
    applicantRosterId: integer('applicant_roster_id'),
    selectionResultRosterId: integer('selection_result_roster_id'),
    actualResultClassId: integer('actual_result_class_id'),
    selectionRuleVersion: text('selection_rule_version'),
    selectionRuleEvidence: text('selection_rule_evidence'),
    sourceMailMessageId: integer('source_mail_message_id'),
    verifiedAt: timestamp('verified_at', { mode: 'date', withTimezone: true }),
    verifiedByUserId: text('verified_by_user_id'),
    // Self-FK is added by migration 0041 with ON DELETE SET NULL.
    supersedesFactId: integer('supersedes_fact_id'),
    validTo: timestamp('valid_to', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tournament_edition_grade_lottery_facts_active_key')
      .on(table.editionId, table.grade)
      .where(sql`${table.validTo} IS NULL`),
    check(
      'tournament_edition_grade_lottery_facts_capacity_positive',
      sql`${table.capacity} IS NULL OR ${table.capacity} > 0`,
    ),
    // Source-preserving SET NULL FKs intentionally are not part of this check.
    // Approval validates required sources; after deletion the fact remains and
    // public metrics become incomplete instead of losing audit history.
    check(
      'tournament_edition_grade_lottery_facts_status_capacity',
      sql`(${table.selectionStatus} = 'lottery' AND ${table.capacity} IS NOT NULL)
        OR (${table.selectionStatus} = 'under_capacity' AND ${table.capacity} IS NOT NULL)
        OR (${table.selectionStatus} = 'no_capacity' AND ${table.capacity} IS NULL)
        OR ${table.selectionStatus} = 'unknown'`,
    ),
    foreignKey({
      columns: [table.editionId],
      foreignColumns: [tournamentSeriesEditions.id],
      name: 'teglf_edition_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.applicantRosterId],
      foreignColumns: [tournamentEntryRosters.id],
      name: 'teglf_applicant_roster_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.selectionResultRosterId],
      foreignColumns: [tournamentEntryRosters.id],
      name: 'teglf_selection_roster_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.actualResultClassId],
      foreignColumns: [tournamentClasses.id],
      name: 'teglf_actual_class_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.sourceMailMessageId],
      foreignColumns: [mailMessages.id],
      name: 'teglf_source_mail_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.verifiedByUserId],
      foreignColumns: [users.id],
      name: 'teglf_verified_by_fk',
    }).onDelete('set null'),
  ],
)
