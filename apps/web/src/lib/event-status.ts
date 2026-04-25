import type { PillTone } from '@/components/ui'

export interface EventStatusResult {
  label: string
  tone: PillTone
}

export function eventStatus(
  status: string | null | undefined,
): EventStatusResult {
  switch (status) {
    case 'published':
      return { label: '公開', tone: 'success' }
    case 'cancelled':
      return { label: '中止', tone: 'danger' }
    case 'done':
      return { label: '終了', tone: 'info' }
    default:
      return { label: '下書き', tone: 'neutral' }
  }
}
