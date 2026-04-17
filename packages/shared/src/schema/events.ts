import { integer, pgTable, text, timestamp, date, boolean } from 'drizzle-orm/pg-core'
import { eventStatusEnum, eventKindEnum, gradeEnum } from './enums'
import { users } from './auth'
import { eventGroups } from './event-groups'

export const events = pgTable('events', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  description: text('description'),
  eventDate: date('event_date', { mode: 'string' }).notNull(),
  startTime: text('start_time'), // HH:mm format
  endTime: text('end_time'),     // HH:mm format
  location: text('location'),
  capacity: integer('capacity'),
  status: eventStatusEnum('status').notNull().default('draft'),
  createdBy: text('created_by').references(() => users.id),
  formalName: text('formal_name'),
  official: boolean('official').notNull().default(true),
  kind: eventKindEnum('kind').notNull().default('individual'),
  entryDeadline: date('entry_deadline', { mode: 'string' }),
  internalDeadline: date('internal_deadline', { mode: 'string' }),
  eventGroupId: integer('event_group_id').references(() => eventGroups.id, { onDelete: 'set null' }),
  eligibleGrades: gradeEnum('eligible_grades').array(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
