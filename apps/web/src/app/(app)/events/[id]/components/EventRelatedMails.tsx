import Link from 'next/link'
import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { events, mailMessages, tournamentDrafts } from '@kagetra/shared/schema'
import { Card } from '@/components/ui'

/**
 * mail-inbox-mailer タスク5: events 詳細「関連メール」セクション (Server Component)。
 *
 * 要件 §3.1.7 — 3 経路 UNION:
 *   (A) `mail_messages.linked_event_id = :eventId`
 *       既存イベント結びつけ経由（補足情報 / 訂正版 / 領収書等）
 *   (B) `tournament_drafts.event_id = :eventId`
 *       linkDraftToEvent 経由（旧フロー: 訂正版 draft → 既存イベント）
 *   (C) `events.tournament_draft_id` 経由（AI 抽出 → 承認で生まれた event）
 *       events.tournament_draft_id → tournament_drafts.id → message_id → mail
 *
 * 結果は受信日降順 + クリックで mail/[id] へ遷移。重複は mail_messages.id で dedup。
 */
export async function EventRelatedMails({ eventId }: { eventId: number }) {
  const mailIds = await collectRelatedMailIds(eventId)
  if (mailIds.length === 0) return null

  const rows = await db
    .select({
      id: mailMessages.id,
      subject: mailMessages.subject,
      fromName: mailMessages.fromName,
      fromAddress: mailMessages.fromAddress,
      receivedAt: mailMessages.receivedAt,
    })
    .from(mailMessages)
    .where(inArray(mailMessages.id, mailIds))
    .orderBy(desc(mailMessages.receivedAt))

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-sm font-semibold text-ink-2">
        関連メール ({rows.length})
      </h2>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <Link key={row.id} href={`/admin/mail-inbox/mail/${row.id}`}>
            <Card className="hover:bg-surface-alt">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink">
                    {row.subject || '(件名なし)'}
                  </span>
                  <span className="shrink-0 text-xs text-ink-meta">
                    {formatJstShort(row.receivedAt)}
                  </span>
                </div>
                <span className="truncate text-xs text-ink-meta">
                  {row.fromName
                    ? `${row.fromName} <${row.fromAddress}>`
                    : row.fromAddress}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}

async function collectRelatedMailIds(eventId: number): Promise<number[]> {
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
  //     tournament_draft_id が立つ）。Codex r7 blocker: 対象 event の
  //     tournamentDraftId を先に取得し、それが non-null のときに draft を
  //     直接 SELECT して messageId を取り出す形に書き換え。意図が明確になる
  //     のと、JOIN ベースより index 利用が素直になる。
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

function formatJstShort(date: Date): string {
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

