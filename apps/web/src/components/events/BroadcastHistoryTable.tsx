import { Pill, type PillTone } from '@/components/ui'

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
 * Per-event delivery audit. Pure server component — manual re-broadcast
 * lives behind a separate Server Action (see PR6) and is not yet wired
 * in here.
 */
export function BroadcastHistoryTable({ rows }: BroadcastHistoryTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-ink-meta px-3 py-4 text-center">
        配信履歴はまだありません。
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((row) => {
        const status = STATUS_LABEL[row.status]
        return (
          <li key={row.id} className="px-3 py-3 flex flex-col gap-1">
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
          </li>
        )
      })}
    </ul>
  )
}
