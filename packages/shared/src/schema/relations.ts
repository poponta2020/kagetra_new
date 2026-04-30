import { relations } from 'drizzle-orm'
import { users } from './auth'
import { events } from './events'
import { eventGroups } from './event-groups'
import { eventAttendances } from './event-attendances'
import { scheduleItems } from './schedule-items'
import { mailMessages } from './mail-messages'
import { mailAttachments } from './mail-attachments'
import { tournamentDrafts } from './tournament-drafts'
import { lineChannels } from './line-channels'
import { mailWorkerJobs, mailWorkerRuns } from './mail-worker'

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
  // PR5: the user → LINE channel relation is one-to-one but its sole FK is
  // `line_channels.assigned_user_id` → `users.id`. Look up a user's channel
  // by querying line_channels with `assignedUserId = users.id`. Pre-fix we
  // also carried `users.line_channel_id` as a reverse pointer, but it had no
  // SQL FK / UNIQUE so the two sides could disagree (review r1).
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

// PR5 (mail-tournament-import)
export const lineChannelsRelations = relations(lineChannels, ({ one }) => ({
  assignedUser: one(users, {
    fields: [lineChannels.assignedUserId],
    references: [users.id],
  }),
}))

export const mailWorkerRunsRelations = relations(mailWorkerRuns, ({ one, many }) => ({
  triggeredBy: one(users, {
    fields: [mailWorkerRuns.triggeredByUserId],
    references: [users.id],
  }),
  jobs: many(mailWorkerJobs),
}))

export const mailWorkerJobsRelations = relations(mailWorkerJobs, ({ one }) => ({
  requestedBy: one(users, {
    fields: [mailWorkerJobs.requestedByUserId],
    references: [users.id],
  }),
  run: one(mailWorkerRuns, {
    fields: [mailWorkerJobs.runId],
    references: [mailWorkerRuns.id],
  }),
}))
