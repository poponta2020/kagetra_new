import { describe, it, expect } from 'vitest'
import {
  eventEntryStatusEnum,
  eventPaymentTypeEnum,
  eventPaymentStatusEnum,
  eventLifecycleNotificationTypeEnum,
  eventLifecycleNotificationStatusEnum,
  events,
  eventLifecycleNotifications,
} from '../src/schema'

describe('event-lifecycle-notify schema', () => {
  it('declares the lifecycle enums with the exact spec values', () => {
    expect(eventEntryStatusEnum.enumValues).toEqual(['not_applied', 'applied'])
    expect(eventPaymentTypeEnum.enumValues).toEqual(['advance', 'onsite'])
    expect(eventPaymentStatusEnum.enumValues).toEqual(['unpaid', 'paid'])
    // Order matters: the daily batch iterates these and the strings are persisted.
    expect(eventLifecycleNotificationTypeEnum.enumValues).toEqual([
      'entry_applied',
      'entry_deadline_advance',
      'entry_deadline_day',
      'payment_paid',
      'payment_deadline_advance',
      'payment_deadline_day',
      'onsite_payment_advance',
      'onsite_payment_day',
      // entry-notify-lottery-treasurer: 申込完了時の 2 通目（会計向け振込案内）。完了トリガー
      // 由来で daily batch は走査しない（reminder batch は type を明示指定するため、末尾追加は安全）。
      'entry_applied_treasurer',
    ])
    expect(eventLifecycleNotificationStatusEnum.enumValues).toEqual(['sent', 'failed', 'skipped'])
  })

  it('adds the lifecycle columns to events with the expected SQL names', () => {
    expect(events.entryStatus.name).toBe('entry_status')
    expect(events.entryAppliedAt.name).toBe('entry_applied_at')
    expect(events.paymentType.name).toBe('payment_type')
    expect(events.paymentStatus.name).toBe('payment_status')
    expect(events.paymentPaidAt.name).toBe('payment_paid_at')
  })

  it('defaults entry/payment status NOT NULL and leaves payment_type nullable', () => {
    expect(events.entryStatus.notNull).toBe(true)
    expect(events.entryStatus.hasDefault).toBe(true)
    expect(events.paymentStatus.notNull).toBe(true)
    expect(events.paymentStatus.hasDefault).toBe(true)
    // payment_type=NULL means "no payment notifications" — must stay nullable.
    expect(events.paymentType.notNull).toBe(false)
  })

  it('defines the once-ever notification log table', () => {
    expect(eventLifecycleNotifications.eventId.name).toBe('event_id')
    expect(eventLifecycleNotifications.type.name).toBe('type')
    expect(eventLifecycleNotifications.status.name).toBe('status')
    expect(eventLifecycleNotifications.status.hasDefault).toBe(true)
  })
})
