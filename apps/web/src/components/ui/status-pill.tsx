import { eventStatus } from '@/lib/event-status'
import { Pill, type PillSize } from './pill'

export interface StatusPillProps {
  /**
   * Event lifecycle status. Maps to a predefined label/tone pair via
   * `eventStatus`. 通常 (`published`) / 未知 / null は何も描画しない
   * （draft 廃止: ピルは中止・終了のときだけ）。
   */
  status: string | null | undefined
  size?: PillSize
}

/**
 * Pill variant that renders event lifecycle status in Japanese.
 * Label/tone mapping lives in `@/lib/event-status` so it stays a single
 * source of truth for server-rendered pages and helpers. Returns `null`
 * (renders nothing) when `eventStatus` decides no pill is warranted.
 */
export function StatusPill({ status, size }: StatusPillProps) {
  const result = eventStatus(status)
  if (!result) return null
  return (
    <Pill tone={result.tone} size={size}>
      {result.label}
    </Pill>
  )
}
