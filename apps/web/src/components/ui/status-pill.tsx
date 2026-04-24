import { eventStatus } from '@/lib/event-status'
import { Pill, type PillSize } from './pill'

export interface StatusPillProps {
  /**
   * Event lifecycle status. Known values map to predefined label/tone pairs
   * via `eventStatus`; anything else falls back to 下書き (draft).
   */
  status: string | null | undefined
  size?: PillSize
}

/**
 * Pill variant that renders event lifecycle status in Japanese.
 * Label/tone mapping lives in `@/lib/event-status` so it stays a single
 * source of truth for server-rendered pages and helpers.
 */
export function StatusPill({ status, size }: StatusPillProps) {
  const { label, tone } = eventStatus(status)
  return (
    <Pill tone={tone} size={size}>
      {label}
    </Pill>
  )
}
