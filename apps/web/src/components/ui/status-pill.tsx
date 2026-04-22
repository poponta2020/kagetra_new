import { Pill, type PillSize, type PillTone } from './pill'

export interface StatusPillProps {
  /**
   * Event lifecycle status. Known values map to predefined label/tone pairs;
   * anything else falls back to 下書き (draft).
   */
  status: 'published' | 'cancelled' | 'done' | (string & {})
  size?: PillSize
}

interface StatusMapping {
  label: string
  tone: PillTone
}

const STATUS_MAP: Record<'published' | 'cancelled' | 'done', StatusMapping> = {
  published: { label: '公開', tone: 'success' },
  cancelled: { label: '中止', tone: 'danger' },
  done: { label: '終了', tone: 'info' },
}

const DEFAULT_MAPPING: StatusMapping = { label: '下書き', tone: 'neutral' }

/**
 * Pill variant that renders event lifecycle status in Japanese.
 *
 * Unknown `status` values render as 下書き so legacy/unexpected codes still
 * display something sensible.
 */
export function StatusPill({ status, size }: StatusPillProps) {
  const mapping =
    status in STATUS_MAP
      ? STATUS_MAP[status as keyof typeof STATUS_MAP]
      : DEFAULT_MAPPING
  return (
    <Pill tone={mapping.tone} size={size}>
      {mapping.label}
    </Pill>
  )
}
