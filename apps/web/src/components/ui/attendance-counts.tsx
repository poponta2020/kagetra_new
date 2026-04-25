import { cn } from '@/lib/utils'

export interface AttendanceEvent {
  /**
   * Attending user IDs. Type is widened to accept either numeric or string IDs
   * since callers may pass DB-native string PKs (e.g. event_attendances.userId);
   * the component itself only reads `.length` from these arrays.
   */
  attendIds: readonly (number | string)[]
  /**
   * Count of users who are not attending. By domain rule, unanswered users are
   * treated as not attending (未回答 = 不参加扱い), so callers should fold the
   * unanswered count into this value rather than surfacing it as a third bucket.
   */
  nonAttendingCount: number
}

export interface AttendanceCountsProps {
  ev: AttendanceEvent
  variant?: 'cards' | 'bar'
}

interface SegmentSpec {
  key: 'attend' | 'nonAttending'
  value: number
  /** Inline `background` value — CSS variable for brand, literal hex for others. */
  background: string
}

interface CardSpec {
  key: 'attend' | 'nonAttending'
  label: string
  count: number
  /** Tailwind classes combining bg + fg tones. */
  classes: string
}

/**
 * Renders attendance tallies as either a 2-up tone-tinted card grid (default)
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
      {
        key: 'nonAttending',
        value: ev.nonAttendingCount,
        background: '#F3B4B4',
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
          <span className="text-danger-fg">
            ● 不参加 {ev.nonAttendingCount}
          </span>
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
      key: 'nonAttending',
      label: '不参加',
      count: ev.nonAttendingCount,
      classes: 'bg-danger-bg text-danger-fg',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-1.5">
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
