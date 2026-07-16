import { asc, desc, eq, inArray } from 'drizzle-orm'
import {
  eventBroadcastGuidelineAttachments,
  events,
  mailAttachments,
  mailMessages,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

/**
 * イベントに関連するメールを集める共有ヘルパー（mail-inbox-mailer タスク5 の
 * EventRelatedMails から抽出）。関連メール一覧の描画と、要綱選択モーダルの候補
 * 収集（broadcast-guidelines-on-link）の両方で再利用する。
 *
 * 3 経路 UNION（mail-inbox-mailer 要件 §3.1.7）:
 *   (A) `mail_messages.linked_event_id = :eventId`
 *       既存イベント結びつけ経由（補足情報 / 訂正版 / 領収書等）
 *   (B) `tournament_drafts.event_id = :eventId`
 *       linkDraftToEvent 経由（旧フロー: 訂正版 draft → 既存イベント）
 *   (C) `events.tournament_draft_id` 経由（AI 抽出 → 承認で生まれた event）
 *       events.tournament_draft_id → tournament_drafts.id → message_id → mail
 *
 * 重複は mail_messages.id で dedup。
 */
export async function collectRelatedMailIds(
  db: typeof appDb,
  eventId: number,
): Promise<number[]> {
  // (A) linked_event_id 直接。
  const linkedRows = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(eq(mailMessages.linkedEventId, eventId))

  // (B) tournament_drafts.event_id = eventId 経由（linkDraftToEvent 経路）。
  //     event_id → draft → message_id (= mail_messages.id)。
  const draftLinkedRows = await db
    .select({ id: tournamentDrafts.messageId })
    .from(tournamentDrafts)
    .where(eq(tournamentDrafts.eventId, eventId))

  // (C) events.tournament_draft_id → drafts.message_id → mail_messages.id
  //     （tournament-title-grade-split 経路: 1 draft : N events、events 側に
  //     tournament_draft_id が立つ）。対象 event の tournamentDraftId を先に
  //     取得し、それが non-null のときに draft を直接 SELECT して messageId を
  //     取り出す。
  const eventDraftRows = await db
    .select({ draftId: events.tournamentDraftId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  const targetDraftId = eventDraftRows[0]?.draftId ?? null
  const synthRows: { id: number }[] = []
  if (targetDraftId !== null) {
    const rows = await db
      .select({ id: tournamentDrafts.messageId })
      .from(tournamentDrafts)
      .where(eq(tournamentDrafts.id, targetDraftId))
    for (const r of rows) synthRows.push(r)
  }

  const set = new Set<number>()
  for (const r of linkedRows) set.add(r.id)
  for (const r of draftLinkedRows) set.add(r.id)
  for (const r of synthRows) set.add(r.id)
  return Array.from(set)
}

export interface GuidelineCandidateAttachment {
  id: number
  filename: string
  sizeBytes: number
  contentType: string
}

export interface GuidelineCandidateMail {
  mailId: number
  subject: string | null
  receivedAt: Date
  attachments: GuidelineCandidateAttachment[]
}

/**
 * 招待コード発行モーダルの「要綱として送信するファイル」候補を、関連メール別に
 * グルーピングして返す（broadcast-guidelines-on-link・AC-1）。
 *
 * 並び: メールは受信日時降順、各メールの添付は id 昇順。添付が 1 件も無いメールは
 * 選択対象が無いので除外する（空なら空配列 = モーダルは空状態を表示）。
 */
export async function loadGuidelineCandidates(
  db: typeof appDb,
  eventId: number,
): Promise<GuidelineCandidateMail[]> {
  const mailIds = await collectRelatedMailIds(db, eventId)
  if (mailIds.length === 0) return []

  const mails = await db
    .select({
      id: mailMessages.id,
      subject: mailMessages.subject,
      receivedAt: mailMessages.receivedAt,
    })
    .from(mailMessages)
    .where(inArray(mailMessages.id, mailIds))
    .orderBy(desc(mailMessages.receivedAt))

  const attachments = await db
    .select({
      id: mailAttachments.id,
      filename: mailAttachments.filename,
      sizeBytes: mailAttachments.sizeBytes,
      contentType: mailAttachments.contentType,
      mailMessageId: mailAttachments.mailMessageId,
    })
    .from(mailAttachments)
    .where(inArray(mailAttachments.mailMessageId, mailIds))
    .orderBy(asc(mailAttachments.id))

  const byMail = new Map<number, GuidelineCandidateAttachment[]>()
  for (const a of attachments) {
    const list = byMail.get(a.mailMessageId)
    const entry = {
      id: a.id,
      filename: a.filename,
      sizeBytes: a.sizeBytes,
      contentType: a.contentType,
    }
    if (list) list.push(entry)
    else byMail.set(a.mailMessageId, [entry])
  }

  return mails.flatMap((m) => {
    const atts = byMail.get(m.id) ?? []
    if (atts.length === 0) return []
    return [
      {
        mailId: m.id,
        subject: m.subject,
        receivedAt: m.receivedAt,
        attachments: atts,
      },
    ]
  })
}

/**
 * 当該 LINE 連携行に「要綱」として選択済みの添付 id 一覧を返す。
 */
export async function loadSelectedGuidelineAttachmentIds(
  db: typeof appDb,
  eventLineBroadcastId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: eventBroadcastGuidelineAttachments.mailAttachmentId })
    .from(eventBroadcastGuidelineAttachments)
    .where(
      eq(
        eventBroadcastGuidelineAttachments.eventLineBroadcastId,
        eventLineBroadcastId,
      ),
    )
  return rows.map((r) => r.id)
}
