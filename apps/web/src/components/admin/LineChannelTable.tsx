import Link from 'next/link'
import { Pill, type PillTone } from '@/components/ui'

export interface LineChannelRow {
  id: number
  botId: string
  note: string | null
  status: 'available' | 'assigned' | 'active' | 'system' | 'disabled'
  /** Event currently consuming this Bot, or null when in the pool. */
  assignedEvent: { id: number; title: string; eventDate: string } | null
  /**
   * Days remaining before the daily release job pulls this Bot back to the
   * pool (`events.event_date + 30 - today`, with `extended_until` taking
   * precedence). Null when the channel is unassigned.
   */
  releaseInDays: number | null
}

export interface LineChannelTableProps {
  rows: readonly LineChannelRow[]
}

const STATUS_LABEL: Record<LineChannelRow['status'], { label: string; tone: PillTone }> = {
  available: { label: '空き', tone: 'success' },
  assigned: { label: '招待コード発行中', tone: 'info' },
  active: { label: '配信中', tone: 'brand' },
  system: { label: 'システム通知', tone: 'warn' },
  disabled: { label: '無効化', tone: 'danger' },
}

/**
 * Read-only render of the 30-Bot broadcast pool (+ the system_notify row).
 * Filtering lives upstream — page.tsx pre-filters via URL search params so
 * this stays a pure server component with no client JS.
 */
export function LineChannelTable({ rows }: LineChannelTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-meta px-4 py-6 text-center">
        該当する Bot がありません
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-ink-meta text-[11px] uppercase tracking-wide">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Bot</th>
            <th className="text-left font-medium px-3 py-2">状態</th>
            <th className="text-left font-medium px-3 py-2">紐付け中の大会</th>
            <th className="text-right font-medium px-3 py-2">残り日数</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = STATUS_LABEL[row.status]
            return (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-ink-1">
                    {row.note ?? row.botId}
                  </div>
                  <div className="text-[10px] text-ink-meta">id: {row.id}</div>
                </td>
                <td className="px-3 py-2 align-top">
                  <Pill tone={status.tone} size="sm">
                    {status.label}
                  </Pill>
                </td>
                <td className="px-3 py-2 align-top text-ink-2">
                  {row.assignedEvent ? (
                    <Link
                      href={`/events/${row.assignedEvent.id}`}
                      className="text-brand hover:underline"
                    >
                      {row.assignedEvent.title}
                    </Link>
                  ) : (
                    <span className="text-ink-meta">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right text-ink-2 tabular-nums">
                  {row.releaseInDays != null ? `${row.releaseInDays} 日` : '—'}
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <Link
                    href={`/admin/line-channels/${row.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    詳細
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
