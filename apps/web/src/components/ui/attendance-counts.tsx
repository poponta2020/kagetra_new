import { cn } from '@/lib/utils'

export interface AttendanceEvent {
  attendIds: number[]
  absentIds: number[]
  unansweredCount: number
}

export interface AttendanceCountsProps {
  ev: AttendanceEvent
  variant?: 'cards' | 'bar'
}

interface SegmentSpec {
  key: 'attend' | 'absent' | 'unanswered'
  value: number
  /** Inline `background` value — CSS variable for brand, literal hex for others. */
  background: string
}

interface CardSpec {
  key: 'attend' | 'absent' | 'unanswered'
  label: string
  count: number
  /** Tailwind classes combining bg + fg tones. */
  classes: string
}

/**
 * Renders attendance tallies as either a 3-up tone-tinted card grid (default)
 * or a horizontal stacked bar with legend.
 *
 * The bar variant uses inline `flex: n` on each segment so segment widths
 * reflect the actual counts — that's the one place in primitives where
 * inline style is load-bearing (values are dynamic, not static tokens).
 */
export function AttendanceCounts({
  ev,
  variant = 'cards',
}: AttendanceCountsProps) {
  if (variant === 'bar') {
    const segments: SegmentSpec[] = [
      {
        key: 'attend',
        value: ev.attendIds.length,
        background: 'var(--kg-brand)',
      },
      { key: 'absent', value: ev.absentIds.length, background: '#F3B4B4' },
      {
        key: 'unanswered',
        value: ev.unansweredCount,
        background: '#F3D78A',
      },
    ]
    return (
      <div>
        <div className="flex h-2 rounded-full overflow-hidden bg-border-soft">
          {segments.map((seg) =>
            seg.value > 0 ? (
              <div
                key={seg.key}
                data-segment={seg.key}
                style={{ flex: seg.value, background: seg.background }}
              />
            ) : null,
          )}
        </div>
        <div className="flex justify-between mt-2 text-[11px]">
          <span className="text-success-fg">● 参加 {ev.attendIds.length}</span>
          <span className="text-danger-fg">● 不参加 {ev.absentIds.length}</span>
          <span className="text-warn-fg">● 未回答 {ev.unansweredCount}</span>
        </div>
      </div>
    )
  }

  const cards: CardSpec[] = [
    {
      key: 'attend',
      label: '参加',
      count: ev.attendIds.length,
      classes: 'bg-success-bg text-success-fg',
    },
    {
      key: 'absent',
      label: '不参加',
      count: ev.absentIds.length,
      classes: 'bg-danger-bg text-danger-fg',
    },
    {
      key: 'unanswered',
      label: '未回答',
      count: ev.unansweredCount,
      classes: 'bg-warn-bg text-warn-fg',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {cards.map((c) => (
        <div
          key={c.key}
          data-card={c.key}
          className={cn('rounded-lg px-2 py-2.5 text-center', c.classes)}
        >
          <div className="text-xl font-bold leading-none">{c.count}</div>
          <div className="text-[10px] mt-1 opacity-80">{c.label}</div>
        </div>
      ))}
    </div>
  )
}
