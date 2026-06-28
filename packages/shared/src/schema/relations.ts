import { relations } from 'drizzle-orm'
import { users } from './auth'
import { events } from './events'
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
import { pushSubscriptions } from './push-subscriptions'
import { players } from './players'
import { tournaments } from './tournaments'
import { tournamentClasses } from './tournament-classes'
import { tournamentParticipants } from './tournament-participants'
import { matches } from './matches'
import { resultDrafts } from './result-drafts'
import { tournamentSeries } from './tournament-series'
import { tournamentSeriesEditions } from './tournament-series-editions'
import { tournamentEntryRosters } from './tournament-entry-rosters'
import { tournamentEntryRosterEntries } from './tournament-entry-roster-entries'

// tournament-entry-rosters (PR-1a baseline): series 1:N editions、edition は
// events / tournaments を束ねるハブ（どちらも N:1）。
export const tournamentSeriesRelations = relations(tournamentSeries, ({ many }) => ({
  editions: many(tournamentSeriesEditions),
}))

export const tournamentSeriesEditionsRelations = relations(
  tournamentSeriesEditions,
  ({ one, many }) => ({
    series: one(tournamentSeries, {
      fields: [tournamentSeriesEditions.seriesId],
      references: [tournamentSeries.id],
    }),
    events: many(events),
    tournaments: many(tournaments),
  }),
)

export const eventsRelations = relations(events, ({ one, many }) => ({
  // tournament-entry-rosters: 開催（edition）。flow①（案内承認）で設定。
  // 旧 eventGroup relation は PR-1b で撤去（束ねは edition に一本化）。
  edition: one(tournamentSeriesEditions, {
    fields: [events.editionId],
    references: [tournamentSeriesEditions.id],
  }),
  // tournament-entry-rosters PR-3: 申込/確定名簿（1 event = applicant/confirmed 各 0..1）。
  rosters: many(tournamentEntryRosters),
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
  // tournament-title-grade-split: AI 取り込み由来イベントの元ドラフト（1 ドラフト:N イベント）。
  // events.tournament_draft_id → tournament_drafts.id。tournament_drafts.event_id（訂正紐付け）
  // 経由の関係と同一テーブルペアで競合するため relationName で区別する。
  sourceDraft: one(tournamentDrafts, {
    fields: [events.tournamentDraftId],
    references: [tournamentDrafts.id],
    relationName: 'eventSourceDraft',
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
  // mail-triage-badge: Web Push 購読は 1 ユーザー複数端末（many）。
  pushSubscriptions: many(pushSubscriptions),
  // PR5: the user → LINE channel relation is one-to-one but its sole FK is
  // `line_channels.assigned_user_id` → `users.id`. Look up a user's channel
  // by querying line_channels with `assignedUserId = users.id`. Pre-fix we
  // also carried `users.line_channel_id` as a reverse pointer, but it had no
  // SQL FK / UNIQUE so the two sides could disagree (review r1).
  // tournament-results: 会員に同定された選手（players.user_id、v1 では基本未紐付け）。
  players: many(players),
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
  // mail-triage-badge: 処理者（nullable, set null）。
  triagedBy: one(users, {
    fields: [mailMessages.triagedByUserId],
    references: [users.id],
  }),
  // tournament-results: 結果 Excel 取込ドラフト（1 メール = 最大 1、message_id UNIQUE）。
  resultDraft: one(resultDrafts, {
    fields: [mailMessages.id],
    references: [resultDrafts.messageId],
  }),
}))

export const mailAttachmentsRelations = relations(mailAttachments, ({ one, many }) => ({
  mail: one(mailMessages, {
    fields: [mailAttachments.mailMessageId],
    references: [mailMessages.id],
  }),
  shareTokens: many(attachmentShareTokens),
}))

export const tournamentDraftsRelations = relations(tournamentDrafts, ({ one, many }) => ({
  mail: one(mailMessages, {
    fields: [tournamentDrafts.messageId],
    references: [mailMessages.id],
  }),
  // event_id 経由: 訂正版ドラフトが指す既存の単一イベント（linkDraftToEvent 専用）。
  event: one(events, {
    fields: [tournamentDrafts.eventId],
    references: [events.id],
    relationName: 'draftCorrectionEvent',
  }),
  // tournament-title-grade-split: この AI 抽出ドラフトから materialize されたイベント群
  // （開催日ごとに分割、events.tournament_draft_id 経由）。
  materializedEvents: many(events, { relationName: 'eventSourceDraft' }),
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

// mail-triage-badge
export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}))

// tournament-results
// 最小限の relations のみ定義する。tournaments.source_result_draft_id（プロビ
// ナンス）と matches.opponent_participant_id は列/FK は保持するが ORM relation
// は張らない（同一テーブルペアの relationName 重複を避けるため。必要になった
// 後続タスクで追加する）。
export const playersRelations = relations(players, ({ one, many }) => ({
  user: one(users, {
    fields: [players.userId],
    references: [users.id],
  }),
  participants: many(tournamentParticipants),
}))

export const tournamentsRelations = relations(tournaments, ({ one, many }) => ({
  classes: many(tournamentClasses),
  // tournament-entry-rosters: 開催（edition）。flow②（結果取込）で設定。
  edition: one(tournamentSeriesEditions, {
    fields: [tournaments.editionId],
    references: [tournamentSeriesEditions.id],
  }),
}))

export const tournamentClassesRelations = relations(tournamentClasses, ({ one, many }) => ({
  tournament: one(tournaments, {
    fields: [tournamentClasses.tournamentId],
    references: [tournaments.id],
  }),
  participants: many(tournamentParticipants),
  matches: many(matches),
}))

export const tournamentParticipantsRelations = relations(
  tournamentParticipants,
  ({ one, many }) => ({
    class: one(tournamentClasses, {
      fields: [tournamentParticipants.classId],
      references: [tournamentClasses.id],
    }),
    player: one(players, {
      fields: [tournamentParticipants.playerId],
      references: [players.id],
    }),
    matches: many(matches),
  }),
)

export const matchesRelations = relations(matches, ({ one }) => ({
  class: one(tournamentClasses, {
    fields: [matches.classId],
    references: [tournamentClasses.id],
  }),
  // composite FK (participant_id, class_id) → tournament_participants(id, class_id)
  // と同じ列集合で結合し、ORM relation を DB 制約に一致させる（Codex R2 should_fix）。
  // id は単独 PK なので結果は同一だが、整合ルールを relation 定義でも表現する。
  participant: one(tournamentParticipants, {
    fields: [matches.participantId, matches.classId],
    references: [tournamentParticipants.id, tournamentParticipants.classId],
  }),
}))

export const resultDraftsRelations = relations(resultDrafts, ({ one }) => ({
  mail: one(mailMessages, {
    fields: [resultDrafts.messageId],
    references: [mailMessages.id],
  }),
  tournament: one(tournaments, {
    fields: [resultDrafts.tournamentId],
    references: [tournaments.id],
  }),
}))

// tournament-entry-rosters (PR-3 名簿)
export const tournamentEntryRostersRelations = relations(
  tournamentEntryRosters,
  ({ one, many }) => ({
    event: one(events, {
      fields: [tournamentEntryRosters.eventId],
      references: [events.id],
    }),
    sourceAttachment: one(mailAttachments, {
      fields: [tournamentEntryRosters.sourceAttachmentId],
      references: [mailAttachments.id],
    }),
    entries: many(tournamentEntryRosterEntries),
  }),
)

export const tournamentEntryRosterEntriesRelations = relations(
  tournamentEntryRosterEntries,
  ({ one }) => ({
    roster: one(tournamentEntryRosters, {
      fields: [tournamentEntryRosterEntries.rosterId],
      references: [tournamentEntryRosters.id],
    }),
    player: one(players, {
      fields: [tournamentEntryRosterEntries.playerId],
      references: [players.id],
    }),
    user: one(users, {
      fields: [tournamentEntryRosterEntries.userId],
      references: [users.id],
    }),
  }),
)
