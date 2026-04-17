import { integer, pgTable, text, timestamp, boolean, unique } from 'drizzle-orm/pg-core'
import { events } from './events'
import { users } from './auth'

export const eventAttendances = pgTable('event_attendances', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  attend: boolean('attend').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.eventId, t.userId)])
