'use client'

import { useState, useTransition } from 'react'
import { Btn, Pill, type PillTone } from '@/components/ui'

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

const STATUS_LABEL: Record<BroadcastHistoryRow['status'], { label: string; tone: PillTone }> = {
  pending: { label: '未配信', tone: 'neutral' },
  sending: { label: '配信中', tone: 'info' },
  sent: { label: '配信済み', tone: 'success' },
  partial: { label: '部分失敗', tone: 'warn' },
  failed: { label: '失敗', tone: 'danger' },
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Per-event delivery audit. r-final-11 should_fix: failed / partial 行に
 * 「再配信」ボタンを表示して manualBroadcast action を起動できるように
 * する (UI に接続)。
 */
export function BroadcastHistoryTable({
  rows,
  eventId,
  manualBroadcastAction,
}: BroadcastHistoryTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-ink-meta px-3 py-4 text-center">
        配信履歴はまだありません。
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border/60">
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
  const status = STATUS_LABEL[row.status]
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const canResend =
    manualBroadcastAction != null &&
    (row.status === 'failed' || row.status === 'partial')

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
    <li className="px-3 py-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {row.isCorrection ? (
            <Pill tone="warn" size="sm">
              訂正
            </Pill>
          ) : null}
          <span className="text-xs text-ink-1 truncate">
            {row.subject ?? `mail #${row.mailMessageId}`}
          </span>
        </div>
        <Pill tone={status.tone} size="sm">
          {status.label}
        </Pill>
      </div>
      <div className="text-[10px] text-ink-meta tabular-nums flex flex-wrap gap-x-3 gap-y-1">
        <span>受信: {formatDateTime(row.receivedAt)}</span>
        <span>配信: {formatDateTime(row.sentAt)}</span>
        <span>
          テキスト {row.sentTextCount} / 画像 {row.sentImageCount}
          {row.fallbackLinkCount > 0 ? ` / リンク ${row.fallbackLinkCount}` : ''}
        </span>
      </div>
      {row.errorMessage ? (
        <p className="text-[10px] text-danger-fg truncate">
          {row.errorMessage}
        </p>
      ) : null}
      {error ? (
        <p className="text-[10px] text-danger-fg">{error}</p>
      ) : null}
      {canResend ? (
        <div className="flex justify-end">
          <Btn
            type="button"
            kind="secondary"
            size="sm"
            onClick={handleResend}
            disabled={pending}
          >
            {pending ? '再配信中…' : '再配信'}
          </Btn>
        </div>
      ) : null}
    </li>
  )
}
