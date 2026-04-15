import { integer, pgTable, text, timestamp, date } from 'drizzle-orm/pg-core'
import { eventStatusEnum } from './enums'
import { users } from './auth'

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
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
