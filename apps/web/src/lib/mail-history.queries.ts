import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  eventBroadcastMessages,
  eventLineBroadcasts,
  events,
  mailAttachments,
  mailMessages,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import { deriveHistory, type HistoryRow } from './mail-history'
import { loadResultImportRows } from './mail-history.result-import'

type DbLike = NodePgDatabase<typeof schema>

/**
 * mail-history: DB からの入力組み立て（requirements.md §3.4）。
 *
 * 純粋な導出ロジックは `mail-history.ts`、H0（試合結果として取り込み）のクエリは
 * `mail-history.result-import.ts` に分離してある。ここは両者の**唯一の配線点**
 * （AC-33: H0 モジュールの削除可搬性を担保する構造）。
 */

export interface HistoryEventRef {
  id: number
  title: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
}

export interface HistoryInput {
  mailId: number
  triageStatus: 'unprocessed' | 'processed'
  triagedAt: Date | null
  mailKind: string | null
  /** H3 用。linked_event_id が指すイベントが属する entry_group の全イベント。 */
  linkedEvents: HistoryEventRef[]
  /** H1 用。承認済みドラフトが無ければ null。 */
  draft: { approvedAt: Date | null; events: HistoryEventRef[] } | null
  /** H2 用。status='sent' の配信のみ。配信ごとに1要素。 */
  broadcasts: {
    sentAt: Date
    includeBody: boolean
    attachmentCount: number
    events: HistoryEventRef[]
  }[]
}

/**
 * `mailIds` ぶんの {@link HistoryInput} を**定数回**のクエリで引く（N+1 禁止）。
 * 空配列なら即 `new Map()`（drizzle の `inArray` は空配列で壊れる）。
 */
export async function loadHistoryInputs(
  dbc: DbLike,
  mailIds: readonly number[],
): Promise<Map<number, HistoryInput>> {
  const inputs = new Map<number, HistoryInput>()
  if (mailIds.length === 0) return inputs

  const ids = [...mailIds]

  // mail_messages 本体（triage 状態・mail_kind・linked_event_id）。
  const mails = await dbc
    .select({
      id: mailMessages.id,
      triageStatus: mailMessages.triageStatus,
      triagedAt: mailMessages.triagedAt,
      mailKind: mailMessages.mailKind,
      linkedEventId: mailMessages.linkedEventId,
    })
    .from(mailMessages)
    .where(inArray(mailMessages.id, ids))

  for (const mail of mails) {
    inputs.set(mail.id, {
      mailId: mail.id,
      triageStatus: mail.triageStatus,
      triagedAt: mail.triagedAt,
      mailKind: mail.mailKind,
      linkedEvents: [],
      draft: null,
      broadcasts: [],
    })
  }

  // H3: linked_event_id → その event の entry_group → 同グループの全イベント。
  const linkedEventIds = Array.from(
    new Set(mails.map((m) => m.linkedEventId).filter((id): id is number => id !== null)),
  )
  if (linkedEventIds.length > 0) {
    const linkedEventRows = await dbc
      .select({ id: events.id, entryGroupId: events.entryGroupId })
      .from(events)
      .where(inArray(events.id, linkedEventIds))
    const groupIdByEventId = new Map(linkedEventRows.map((e) => [e.id, e.entryGroupId]))
    const groupIds = Array.from(new Set(linkedEventRows.map((e) => e.entryGroupId)))

    if (groupIds.length > 0) {
      const groupEvents = await dbc
        .select({
          id: events.id,
          title: events.title,
          eventDate: events.eventDate,
          entryGroupId: events.entryGroupId,
        })
        .from(events)
        .where(inArray(events.entryGroupId, groupIds))
      const eventsByGroup = new Map<number, HistoryEventRef[]>()
      for (const e of groupEvents) {
        const ref: HistoryEventRef = { id: e.id, title: e.title, eventDate: e.eventDate }
        const bucket = eventsByGroup.get(e.entryGroupId)
        if (bucket) bucket.push(ref)
        else eventsByGroup.set(e.entryGroupId, [ref])
      }

      for (const mail of mails) {
        if (mail.linkedEventId === null) continue
        const groupId = groupIdByEventId.get(mail.linkedEventId)
        if (groupId === undefined) continue
        const input = inputs.get(mail.id)
        if (input) input.linkedEvents = eventsByGroup.get(groupId) ?? []
      }
    }
  }

  // H1: tournament_drafts(status='approved') の対象イベントは、events.tournament_draft_id
  // の逆参照（級別分割承認）と tournament_drafts.event_id の直接参照（訂正版の紐付け）の
  // 和集合（AC-12b）。event id で重複排除する（両方から同じイベントが引けることがある）。
  const drafts = await dbc
    .select({
      id: tournamentDrafts.id,
      messageId: tournamentDrafts.messageId,
      approvedAt: tournamentDrafts.approvedAt,
      eventId: tournamentDrafts.eventId,
    })
    .from(tournamentDrafts)
    .where(and(inArray(tournamentDrafts.messageId, ids), eq(tournamentDrafts.status, 'approved')))

  if (drafts.length > 0) {
    const draftIds = drafts.map((d) => d.id)
    const reverseEvents = await dbc
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        tournamentDraftId: events.tournamentDraftId,
      })
      .from(events)
      .where(inArray(events.tournamentDraftId, draftIds))

    const directEventIds = Array.from(
      new Set(drafts.map((d) => d.eventId).filter((id): id is number => id !== null)),
    )
    const directEvents =
      directEventIds.length > 0
        ? await dbc
            .select({ id: events.id, title: events.title, eventDate: events.eventDate })
            .from(events)
            .where(inArray(events.id, directEventIds))
        : []
    const directEventById = new Map(directEvents.map((e) => [e.id, e]))

    for (const draft of drafts) {
      const byId = new Map<number, HistoryEventRef>()
      for (const e of reverseEvents) {
        if (e.tournamentDraftId === draft.id) {
          byId.set(e.id, { id: e.id, title: e.title, eventDate: e.eventDate })
        }
      }
      if (draft.eventId !== null) {
        const direct = directEventById.get(draft.eventId)
        if (direct) byId.set(direct.id, { id: direct.id, title: direct.title, eventDate: direct.eventDate })
      }
      const input = inputs.get(draft.messageId)
      if (input) input.draft = { approvedAt: draft.approvedAt, events: Array.from(byId.values()) }
    }
  }

  // H2: event_broadcast_messages(status='sent') → event_line_broadcasts.entry_group_id
  // → events.entry_group_id の3ホップ。添付件数はそのメールの添付総数（配信ごとではない。
  // line-broadcast.ts が mail_message_id 単位で全添付を送るため画面の添付一覧と一致する）。
  const broadcastMessages = await dbc
    .select({
      mailMessageId: eventBroadcastMessages.mailMessageId,
      sentAt: eventBroadcastMessages.sentAt,
      includeBody: eventBroadcastMessages.includeBody,
      eventLineBroadcastId: eventBroadcastMessages.eventLineBroadcastId,
    })
    .from(eventBroadcastMessages)
    .where(
      and(inArray(eventBroadcastMessages.mailMessageId, ids), eq(eventBroadcastMessages.status, 'sent')),
    )

  if (broadcastMessages.length > 0) {
    const broadcastIds = Array.from(new Set(broadcastMessages.map((b) => b.eventLineBroadcastId)))
    const broadcastRows = await dbc
      .select({ id: eventLineBroadcasts.id, entryGroupId: eventLineBroadcasts.entryGroupId })
      .from(eventLineBroadcasts)
      .where(inArray(eventLineBroadcasts.id, broadcastIds))
    const groupIdByBroadcastId = new Map(broadcastRows.map((b) => [b.id, b.entryGroupId]))
    const groupIds = Array.from(new Set(broadcastRows.map((b) => b.entryGroupId)))

    const eventsByGroup = new Map<number, HistoryEventRef[]>()
    if (groupIds.length > 0) {
      const groupEvents = await dbc
        .select({
          id: events.id,
          title: events.title,
          eventDate: events.eventDate,
          entryGroupId: events.entryGroupId,
        })
        .from(events)
        .where(inArray(events.entryGroupId, groupIds))
      for (const e of groupEvents) {
        const ref: HistoryEventRef = { id: e.id, title: e.title, eventDate: e.eventDate }
        const bucket = eventsByGroup.get(e.entryGroupId)
        if (bucket) bucket.push(ref)
        else eventsByGroup.set(e.entryGroupId, [ref])
      }
    }

    // AC-28: mail_attachments.data（bytea）は projection に含めない。添付件数は count(*)。
    const mailIdsForAttachments = Array.from(new Set(broadcastMessages.map((b) => b.mailMessageId)))
    const attachmentCounts = await dbc
      .select({ mailMessageId: mailAttachments.mailMessageId, count: sql<number>`count(*)::int` })
      .from(mailAttachments)
      .where(inArray(mailAttachments.mailMessageId, mailIdsForAttachments))
      .groupBy(mailAttachments.mailMessageId)
    const countByMailId = new Map(attachmentCounts.map((c) => [c.mailMessageId, c.count]))

    for (const broadcast of broadcastMessages) {
      // status='sent' だが sent_at が未設定の行は履歴に出さない（本来あり得ないが防御的に）。
      if (broadcast.sentAt === null) continue
      const groupId = groupIdByBroadcastId.get(broadcast.eventLineBroadcastId)
      const eventsForBroadcast = groupId !== undefined ? (eventsByGroup.get(groupId) ?? []) : []
      const input = inputs.get(broadcast.mailMessageId)
      if (!input) continue
      input.broadcasts.push({
        sentAt: broadcast.sentAt,
        includeBody: broadcast.includeBody,
        attachmentCount: countByMailId.get(broadcast.mailMessageId) ?? 0,
        events: eventsForBroadcast,
      })
    }
  }

  return inputs
}

/** 一覧・詳細が使う入口。H0 を含めて完成した履歴を返す。 */
export async function loadHistories(
  dbc: DbLike,
  mailIds: readonly number[],
): Promise<Map<number, HistoryRow[]>> {
  const result = new Map<number, HistoryRow[]>()
  if (mailIds.length === 0) return result

  const [inputs, resultImportRows] = await Promise.all([
    loadHistoryInputs(dbc, mailIds),
    // ★H0 の唯一の配線点（senseki-boundary 物理削除時はこの1行と import を外す）。
    loadResultImportRows(dbc, mailIds),
  ])

  for (const [mailId, input] of inputs) {
    const h0Row = resultImportRows.get(mailId)
    const extraRows = h0Row ? [h0Row] : []
    result.set(mailId, deriveHistory(input, extraRows))
  }

  return result
}
