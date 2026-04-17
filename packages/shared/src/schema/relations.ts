import { relations } from 'drizzle-orm'
import { users } from './auth'
import { events } from './events'
import { eventGroups } from './event-groups'
import { eventAttendances } from './event-attendances'
import { scheduleItems } from './schedule-items'

export const eventGroupsRelations = relations(eventGroups, ({ many }) => ({
  events: many(events),
}))

export const eventsRelations = relations(events, ({ one, many }) => ({
  eventGroup: one(eventGroups, {
    fields: [events.eventGroupId],
    references: [eventGroups.id],
  }),
  attendances: many(eventAttendances),
  creator: one(users, {
    fields: [events.createdBy],
    references: [users.id],
  }),
}))

export const eventAttendancesRelations = relations(eventAttendances, ({ one }) => ({
  event: one(events, {
    fields: [eventAttendances.eventId],
    references: [events.id],
  }),
  user: one(users, {
    fields: [eventAttendances.userId],
    references: [users.id],
  }),
}))

export const usersRelations = relations(users, ({ many }) => ({
  attendances: many(eventAttendances),
}))

export const scheduleItemsRelations = relations(scheduleItems, ({ one }) => ({
  owner: one(users, {
    fields: [scheduleItems.ownerId],
    references: [users.id],
  }),
}))
