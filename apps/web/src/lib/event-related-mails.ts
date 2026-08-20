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
  return collectRelatedMailIdsForGroup(db, [eventId])
}

/**
 * entry-group-page タスク3 (AC-25): {@link collectRelatedMailIds} の複数イベント版。
 * 申込グループの**全日分**を同じ 3 経路で集め、`mail_messages.id` で dedup する
 * （関連メールはグループページへ移設され、日ページからは撤去される）。
 *
 * 日ごとに 3 クエリを撃たず、`inArray` でまとめて 1 経路 1 クエリに畳む
 * （グループは高々数日だが、経路ごとのクエリ本数を日数に比例させない）。
 * 単一イベントで呼んだときの結果は従来と同一（{@link collectRelatedMailIds} は
 * この関数への薄いラッパー）。
 */
export async function collectRelatedMailIdsForGroup(
  db: typeof appDb,
  eventIds: readonly number[],
): Promise<number[]> {
  const ids = Array.from(new Set(eventIds))
  if (ids.length === 0) return []

  // (A) linked_event_id 直接。
  const linkedRows = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(inArray(mailMessages.linkedEventId, ids))

  // (B) tournament_drafts.event_id 経由（linkDraftToEvent 経路）。
  //     event_id → draft → message_id (= mail_messages.id)。
  const draftLinkedRows = await db
    .select({ id: tournamentDrafts.messageId })
    .from(tournamentDrafts)
    .where(inArray(tournamentDrafts.eventId, ids))

  // (C) events.tournament_draft_id → drafts.message_id → mail_messages.id
  //     （tournament-title-grade-split 経路: 1 draft : N events、events 側に
  //     tournament_draft_id が立つ）。対象 event の tournamentDraftId を先に
  //     取得し、非 null のものだけ draft を SELECT して messageId を取り出す。
  const eventDraftRows = await db
    .select({ draftId: events.tournamentDraftId })
    .from(events)
    .where(inArray(events.id, ids))
  const draftIds = Array.from(
    new Set(
      eventDraftRows
        .map((r) => r.draftId)
        .filter((id): id is number => id !== null),
    ),
  )
  const synthRows =
    draftIds.length === 0
      ? []
      : await db
          .select({ id: tournamentDrafts.messageId })
          .from(tournamentDrafts)
          .where(inArray(tournamentDrafts.id, draftIds))

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
