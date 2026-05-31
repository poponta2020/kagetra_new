'use client'

import { useState, useTransition } from 'react'
import { Btn, Card, SectionLabel } from '@/components/ui'
import {
  LifecycleStatusBadge,
  type EntryStatus,
  type PaymentStatus,
  type PaymentType,
} from './LifecycleStatusBadge'

export interface EventLifecycleSectionProps {
  eventId: number
  entryStatus: EntryStatus
  entryAppliedAt: Date | string | null
  paymentType: PaymentType | null
  paymentStatus: PaymentStatus
  paymentPaidAt: Date | string | null
  feeJpy: number | null
  entryDeadline: string | null
  paymentDeadline: string | null
  /**
   * Whether the event has a live (`linked`) LINE group. Drives the "通知が
   * 送られます" confirmation and the no-binding notice. State changes are always
   * persisted; the notification only fires when linked.
   */
  isLineLinked: boolean
  setEntryAppliedAction: (eventId: number, applied: boolean) => Promise<void>
  setPaymentTypeAction: (
    eventId: number,
    type: 'advance' | 'onsite' | null,
  ) => Promise<void>
  setPaymentPaidAction: (eventId: number, paid: boolean) => Promise<void>
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

const SELECT_CLASS =
  'rounded-md border border-border bg-canvas px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'

/**
 * Admin-only 進行管理 section on /events/[id]: toggle 申込/支払 state, pick the
 * payment type, and (when linked) confirm before a group notification fires.
 * Renders the read-only LifecycleStatusBadge inline so the operator sees the
 * same pills members see.
 */
export function EventLifecycleSection({
  eventId,
  entryStatus,
  entryAppliedAt,
  paymentType,
  paymentStatus,
  paymentPaidAt,
  feeJpy,
  entryDeadline,
  paymentDeadline,
  isLineLinked,
  setEntryAppliedAction,
  setPaymentTypeAction,
  setPaymentPaidAction,
}: EventLifecycleSectionProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  /**
   * Run a state-change action. When `willNotify` and the group is linked, ask
   * for confirmation first (a completion push will be sent). Reverts and
   * payment-type changes pass willNotify=false (no notification).
   */
  function run(action: () => Promise<void>, willNotify: boolean) {
    setError(null)
    if (willNotify && isLineLinked && typeof window !== 'undefined') {
      const ok = window.confirm(
        '参加者の LINE グループに通知が送られます。よろしいですか？',
      )
      if (!ok) return
    }
    startTransition(async () => {
      try {
        await action()
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました')
      }
    })
  }

  const entryApplied = entryStatus === 'applied'
  const paymentPaid = paymentStatus === 'paid'

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionLabel>進行管理</SectionLabel>
        <LifecycleStatusBadge
          entryStatus={entryStatus}
          paymentType={paymentType}
          paymentStatus={paymentStatus}
        />
      </div>

      <Card className="px-3 py-3 flex flex-col gap-4 text-xs text-ink-2">
        {/* 申込状態 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-meta">申込状態</span>
            <Btn
              type="button"
              kind={entryApplied ? 'secondary' : 'primary'}
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(() => setEntryAppliedAction(eventId, !entryApplied), !entryApplied)
              }
            >
              {entryApplied ? '未申込に戻す' : '申込済にする'}
            </Btn>
          </div>
          {entryApplied && (
            <p className="text-[11px] text-ink-meta">
              申込日時: {formatDateTime(entryAppliedAt)}
            </p>
          )}
        </div>

        {/* 支払いタイプ */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-meta">支払いタイプ</span>
          <select
            className={SELECT_CLASS}
            value={paymentType ?? ''}
            disabled={isPending}
            onChange={(e) => {
              const next = e.target.value === '' ? null : (e.target.value as PaymentType)
              run(() => setPaymentTypeAction(eventId, next), false)
            }}
          >
            <option value="">未設定</option>
            <option value="advance">事前払い</option>
            <option value="onsite">現地払い</option>
          </select>
        </div>

        {/* 支払状態 (事前払いのみ) */}
        {paymentType === 'advance' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-meta">支払状態</span>
              <Btn
                type="button"
                kind={paymentPaid ? 'secondary' : 'primary'}
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(() => setPaymentPaidAction(eventId, !paymentPaid), !paymentPaid)
                }
              >
                {paymentPaid ? '未払に戻す' : '支払済にする'}
              </Btn>
            </div>
            {paymentPaid && (
              <p className="text-[11px] text-ink-meta">
                支払日時: {formatDateTime(paymentPaidAt)}
              </p>
            )}
          </div>
        )}

        {/* 締切・料金の参照（編集はイベント編集フォーム側） */}
        <dl className="flex flex-col gap-1 border-t border-border-soft pt-2 text-[11px]">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-meta">大会申込締切</dt>
            <dd className="text-ink-1">{entryDeadline ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-meta">支払締切</dt>
            <dd className="text-ink-1">{paymentDeadline ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-meta">参加費</dt>
            <dd className="text-ink-1">
              {feeJpy != null ? `${feeJpy.toLocaleString('ja-JP')}円` : '—'}
            </dd>
          </div>
        </dl>

        {!isLineLinked && (
          <p className="text-[10px] text-ink-meta">
            ※ LINE グループ未紐付けのため、状態を変更しても通知は送られません。
          </p>
        )}
        {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
      </Card>
    </section>
  )
}
