import Link from 'next/link'
import { desc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mailMessages } from '@kagetra/shared/schema'
import { collectRelatedMailIdsForGroup } from '@/lib/event-related-mails'
import { formatDateTimeShort } from '@/lib/event-date'
import { DisclosureSection } from './detail'

/**
 * mail-inbox-mailer タスク5 / event-detail-redesign タスク4:
 * events 詳細「関連メール」セクション (Server Component)。開閉トグル化
 * （既定=閉。管理者のみは維持——呼び出し元 page.tsx が isAdmin 判定で
 * このコンポーネント自体を出し分ける）。
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
 *
 * entry-group-page タスク3 (AC-25): 受け取るのは**イベント id の配列**。申込
 * グループページがグループ全日分を UNION して渡す（日ページからこのセクションは
 * 撤去される）。3 経路 UNION の中身は従来と同一。
 */
export async function EventRelatedMails({
  eventIds,
}: {
  eventIds: readonly number[]
}) {
  const mailIds = await collectRelatedMailIdsForGroup(db, eventIds)
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
    <DisclosureSection
      title="関連メール"
      aux={`${rows.length}件`}
      nested
      // セクション間余白（モックの `.sec{padding:34px 0 0}`）は自前で持つ。
      // 0 件では上で null を返すので、呼び出し側がラッパーで付けると空の
      // 34px が残ってしまう。
      className="pt-[34px]"
    >
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/admin/mail-inbox/mail/${row.id}`}
          className="mt-[7px] block rounded-lg border border-border-soft bg-surface px-3 py-[10px] shadow-sm first:mt-[10px]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-ink">
              {row.subject || '(件名なし)'}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-neutral-fg">
              {formatDateTimeShort(row.receivedAt)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-meta">
            {row.fromName ?? row.fromAddress}
          </div>
        </Link>
      ))}
    </DisclosureSection>
  )
}
