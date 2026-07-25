import { Pill } from '@/components/ui'

export type EntryStatus = 'not_applied' | 'applied' | 'not_applying'
export type PaymentType = 'advance' | 'onsite'
export type PaymentStatus = 'unpaid' | 'paid'

export interface LifecycleStatusBadgeProps {
  entryStatus: EntryStatus
  paymentType: PaymentType | null
  paymentStatus: PaymentStatus
}

const ENTRY_STATUS_PILL: Record<
  EntryStatus,
  { tone: 'success' | 'neutral' | 'info'; label: string }
> = {
  not_applied: { tone: 'neutral', label: '未申込' },
  applied: { tone: 'success', label: '申込済' },
  // entry-overdue-alert: 「申込者がいないため今回は申し込まない」。要件 §8。
  not_applying: { tone: 'info', label: '申込なし' },
}

/**
 * Read-only lifecycle status pills (申込 / 支払い). Server-renderable and shown
 * to general members too — no controls, no admin-only data. The payment pill is
 * omitted when payment_type is unset (= no payment tracking for this event),
 * and also omitted entirely when entryStatus is `not_applying` — a tournament
 * we're not entering has no meaningful payment state, and stacking it next to
 * the same-tone (`info`) 現地払い pill would read as two unrelated badges
 * (要件 §8).
 */
export function LifecycleStatusBadge({
  entryStatus,
  paymentType,
  paymentStatus,
}: LifecycleStatusBadgeProps) {
  const entryPill = ENTRY_STATUS_PILL[entryStatus]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone={entryPill.tone} size="sm">
        {entryPill.label}
      </Pill>
      {entryStatus !== 'not_applying' && paymentType === 'advance' && (
        <Pill tone={paymentStatus === 'paid' ? 'success' : 'warn'} size="sm">
          {paymentStatus === 'paid' ? '支払済' : '未払'}
        </Pill>
      )}
      {entryStatus !== 'not_applying' && paymentType === 'onsite' && (
        <Pill tone="info" size="sm">
          現地払い
        </Pill>
      )}
    </div>
  )
}
