import { Pill } from '@/components/ui'

export type EntryStatus = 'not_applied' | 'applied'
export type PaymentType = 'advance' | 'onsite'
export type PaymentStatus = 'unpaid' | 'paid'

export interface LifecycleStatusBadgeProps {
  entryStatus: EntryStatus
  paymentType: PaymentType | null
  paymentStatus: PaymentStatus
}

/**
 * Read-only lifecycle status pills (申込 / 支払い). Server-renderable and shown
 * to general members too — no controls, no admin-only data. The payment pill is
 * omitted when payment_type is unset (= no payment tracking for this event).
 */
export function LifecycleStatusBadge({
  entryStatus,
  paymentType,
  paymentStatus,
}: LifecycleStatusBadgeProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone={entryStatus === 'applied' ? 'success' : 'neutral'} size="sm">
        {entryStatus === 'applied' ? '申込済' : '未申込'}
      </Pill>
      {paymentType === 'advance' && (
        <Pill tone={paymentStatus === 'paid' ? 'success' : 'warn'} size="sm">
          {paymentStatus === 'paid' ? '支払済' : '未払'}
        </Pill>
      )}
      {paymentType === 'onsite' && (
        <Pill tone="info" size="sm">
          現地払い
        </Pill>
      )}
    </div>
  )
}
