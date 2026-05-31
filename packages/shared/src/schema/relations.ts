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
import { eventLineBroadcasts } from './event-line-broadcasts'
import { eventBroadcastMessages } from './event-broadcast-messages'
import { attachmentShareTokens } from './attachment-share-tokens'
import { eventLifecycleNotifications } from './event-lifecycle-notifications'

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
  // event-line-broadcast: 1:1 via event_line_broadcasts.event_id UNIQUE
  //
  // r-final-8 should_fix: 逆参照 (FK は子側 = eventLineBroadcasts) の
  // `one()` は fields/references を省略すると drizzle が自動で「対側の
  // 該当 FK で繋ぐ」逆方向 relation として扱う。fields に events.id を
  // 指定すると source 側に存在しない FK を持つ形になって不正な join に
  // なるので、ここは省略形 (drizzle 標準パターン) に揃える。
  lineBroadcast: one(eventLineBroadcasts),
  // event-lifecycle-notify: once-ever 通知ログ（1 event = N 種別）
  lifecycleNotifications: many(eventLifecycleNotifications),
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
  broadcastMessages: many(eventBroadcastMessages),
}))

export const mailAttachmentsRelations = relations(mailAttachments, ({ one, many }) => ({
  mail: one(mailMessages, {
    fields: [mailAttachments.mailMessageId],
    references: [mailMessages.id],
  }),
  shareTokens: many(attachmentShareTokens),
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

// PR5 (mail-tournament-import) + event-line-broadcast
export const lineChannelsRelations = relations(lineChannels, ({ one }) => ({
  assignedUser: one(users, {
    fields: [lineChannels.assignedUserId],
    references: [users.id],
  }),
  assignedEvent: one(events, {
    fields: [lineChannels.assignedEventId],
    references: [events.id],
  }),
}))

// event-line-broadcast
export const eventLineBroadcastsRelations = relations(
  eventLineBroadcasts,
  ({ one, many }) => ({
    event: one(events, {
      fields: [eventLineBroadcasts.eventId],
      references: [events.id],
    }),
    lineChannel: one(lineChannels, {
      fields: [eventLineBroadcasts.lineChannelId],
      references: [lineChannels.id],
    }),
    messages: many(eventBroadcastMessages),
  }),
)

export const eventBroadcastMessagesRelations = relations(eventBroadcastMessages, ({ one }) => ({
  broadcast: one(eventLineBroadcasts, {
    fields: [eventBroadcastMessages.eventLineBroadcastId],
    references: [eventLineBroadcasts.id],
  }),
  mail: one(mailMessages, {
    fields: [eventBroadcastMessages.mailMessageId],
    references: [mailMessages.id],
  }),
}))

export const attachmentShareTokensRelations = relations(attachmentShareTokens, ({ one }) => ({
  attachment: one(mailAttachments, {
    fields: [attachmentShareTokens.mailAttachmentId],
    references: [mailAttachments.id],
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

// event-lifecycle-notify
export const eventLifecycleNotificationsRelations = relations(
  eventLifecycleNotifications,
  ({ one }) => ({
    event: one(events, {
      fields: [eventLifecycleNotifications.eventId],
      references: [events.id],
    }),
  }),
)
