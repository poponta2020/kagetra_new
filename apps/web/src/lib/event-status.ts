import type { PillTone } from '@/components/ui'

export interface EventStatusResult {
  label: string
  tone: PillTone
}

/**
 * Map an event lifecycle status to its pill label/tone, or `null` when no pill
 * should be shown.
 *
 * draft 廃止: 通常状態 (`published`) は「正常」なのでピルを出さない（=null）。
 * 中止 (`cancelled`) / 終了 (`done`) のときだけピルを出す。未知値・null・
 * undefined も安全側に倒してピル非表示（null）にフォールバックする。
 */
export function eventStatus(
  status: string | null | undefined,
): EventStatusResult | null {
  switch (status) {
    case 'cancelled':
      return { label: '中止', tone: 'danger' }
    case 'done':
      return { label: '終了', tone: 'info' }
    default:
      // published（通常）/ 未知 / null / undefined はピル非表示。
      return null
  }
}
