'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { formatDateTimeShort } from '@/lib/event-date'
import { LinkAction } from './detail'

export interface BroadcastHistoryRow {
  id: number
  status: 'pending' | 'sending' | 'sent' | 'partial' | 'failed'
  isCorrection: boolean
  mailMessageId: number
  subject: string | null
  receivedAt: Date | string | null
  sentAt: Date | string | null
  sentTextCount: number
  sentImageCount: number
  fallbackLinkCount: number
  errorMessage: string | null
}

export interface BroadcastHistoryTableProps {
  rows: readonly BroadcastHistoryRow[]
  eventId: number
  /**
   * Server Action: 強制再送 (force=true 相当)。failed / partial の運用
   * 復旧用に渡される。null の場合は再配信ボタンを出さない (一覧表示専用)。
   */
  manualBroadcastAction?: (
    eventId: number,
    mailMessageId: number,
  ) => Promise<void>
}

const STATUS_LABEL: Record<BroadcastHistoryRow['status'], string> = {
  pending: '未配信',
  sending: '配信中',
  sent: '配信済み',
  partial: '部分失敗',
  failed: '失敗',
}

function metricsText(row: BroadcastHistoryRow): string {
  let text = `テキスト${row.sentTextCount}・画像${row.sentImageCount}`
  if (row.fallbackLinkCount > 0) text += `・リンク${row.fallbackLinkCount}`
  return text
}

/**
 * Per-event delivery audit. event-detail-redesign タスク5で罫線リストへ
 * 置き換え（脱カード・脱チップ）。r-final-11 should_fix: failed / partial 行に
 * 「再配信」を表示して manualBroadcast action を起動できるようにする。
 */
export function BroadcastHistoryTable({
  rows,
  eventId,
  manualBroadcastAction,
}: BroadcastHistoryTableProps) {
  if (rows.length === 0) {
    return (
      <p className="py-3 text-center text-xs text-neutral-fg">
        配信履歴はまだありません。
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border-soft">
      {rows.map((row) => (
        <HistoryRow
          key={row.id}
          row={row}
          eventId={eventId}
          manualBroadcastAction={manualBroadcastAction}
        />
      ))}
    </ul>
  )
}

function HistoryRow({
  row,
  eventId,
  manualBroadcastAction,
}: {
  row: BroadcastHistoryRow
  eventId: number
  manualBroadcastAction?: (
    eventId: number,
    mailMessageId: number,
  ) => Promise<void>
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const canResend =
    manualBroadcastAction != null &&
    (row.status === 'failed' || row.status === 'partial')
  const isWarn = row.status === 'partial' || row.status === 'failed'

  function handleResend() {
    if (!manualBroadcastAction) return
    setError(null)
    startTransition(async () => {
      try {
        await manualBroadcastAction(eventId, row.mailMessageId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '再配信に失敗しました')
      }
    })
  }

  return (
    <li className="py-[10px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {row.isCorrection ? <span className="text-ink-meta">訂正 </span> : null}
          {row.subject ?? `mail #${row.mailMessageId}`}
        </span>
        <span
          className={cn(
            'flex-none text-xs',
            isWarn ? 'text-accent-fg' : 'text-ink-meta',
          )}
        >
          {STATUS_LABEL[row.status]}
        </span>
      </div>
      <div className="mt-[3px] flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-neutral-fg">
        <span>受信 {formatDateTimeShort(row.receivedAt)}</span>
        <span>配信 {formatDateTimeShort(row.sentAt)}</span>
        <span>{metricsText(row)}</span>
      </div>
      {row.errorMessage ? (
        <p className="mt-[3px] text-xs text-accent-fg">{row.errorMessage}</p>
      ) : null}
      {error ? <p className="mt-[3px] text-xs text-accent-fg">{error}</p> : null}
      {canResend ? (
        <div className="mt-[5px]">
          <LinkAction onClick={handleResend} disabled={pending}>
            {pending ? '再配信中…' : '再配信'}
          </LinkAction>
        </div>
      ) : null}
    </li>
  )
}
