import { integer, pgTable, text, timestamp, date, boolean } from 'drizzle-orm/pg-core'
import { scheduleKindEnum } from './enums'
import { users } from './auth'

export const scheduleItems = pgTable('schedule_items', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  date: date('date', { mode: 'string' }).notNull(),
  kind: scheduleKindEnum('kind').notNull().default('other'),
  name: text('name').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  location: text('location'),
  description: text('description'),
  isPublic: boolean('is_public').notNull().default(true),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
