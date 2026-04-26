import { relations } from 'drizzle-orm'
import { users } from './auth'
import { events } from './events'
import { eventGroups } from './event-groups'
import { eventAttendances } from './event-attendances'
import { scheduleItems } from './schedule-items'
import { mailMessages } from './mail-messages'
import { mailAttachments } from './mail-attachments'
import { tournamentDrafts } from './tournament-drafts'

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

export const mailMessagesRelations = relations(mailMessages, ({ one, many }) => ({
  attachments: many(mailAttachments),
  draft: one(tournamentDrafts, {
    fields: [mailMessages.id],
    references: [tournamentDrafts.messageId],
  }),
}))

export const mailAttachmentsRelations = relations(mailAttachments, ({ one }) => ({
  mail: one(mailMessages, {
    fields: [mailAttachments.mailMessageId],
    references: [mailMessages.id],
  }),
}))

export const tournamentDraftsRelations = relations(tournamentDrafts, ({ one }) => ({
  mail: one(mailMessages, {
    fields: [tournamentDrafts.messageId],
    references: [mailMessages.id],
  }),
  event: one(events, {
    fields: [tournamentDrafts.eventId],
    references: [events.id],
  }),
}))
