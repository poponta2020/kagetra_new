'use client'

import { useState, useTransition } from 'react'
import { formatDateTimeShort } from '@/lib/event-date'
import type { ResendPaymentReportResult } from '../actions'

/**
 * payment-receipt-broadcast タスク9: 支払報告の履歴（進行管理「支払状態」行の中）。
 *
 * 1行 = 1回の支払報告（日時・実行者・想定額・枚数・状態）＋ 証憑のサムネ ＋「再送」。
 * **未払に戻しても履歴は消えない**（要件 §3.2.5-19 / AC-19）ので、ここは支払状態の
 * 現在値とは独立に、送った回数ぶんだけ時系列で並ぶ。
 *
 * 再送だけは操作なので client component。表示は Server Component（page.tsx）が
 * 組んだ値をそのまま出す。
 */

export interface PaymentReportHistoryRow {
  id: number
  createdAt: Date | string
  createdByName: string | null
  amountJpy: number | null
  receiptCount: number
  status: 'sent' | 'failed' | 'skipped_unlinked'
  lastSentAt: Date | string | null
  /** 証憑の公開トークン（`sort_order` 順）。サムネ URL の組み立てに使う。 */
  receiptTokens: string[]
}

export interface PaymentReportHistoryProps {
  rows: readonly PaymentReportHistoryRow[]
  resendAction: (reportId: number) => Promise<ResendPaymentReportResult>
}

const STATUS_LABEL: Record<PaymentReportHistoryRow['status'], { text: string; tone: string }> = {
  sent: { text: '送信済', tone: 'text-brand-fg' },
  failed: { text: '送信失敗', tone: 'text-danger-fg' },
  skipped_unlinked: { text: 'LINE未連携', tone: 'text-warn-fg' },
}

export function PaymentReportHistory({ rows, resendAction }: PaymentReportHistoryProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [resentId, setResentId] = useState<number | null>(null)

  if (rows.length === 0) return null

  function resend(reportId: number) {
    setError(null)
    setResentId(null)
    if (typeof window !== 'undefined') {
      const ok = window.confirm('同じ内容をもう一度 LINE グループへ送ります。よろしいですか？')
      if (!ok) return
    }
    startTransition(async () => {
      try {
        const result = await resendAction(reportId)
        if ('error' in result) {
          setError(result.error)
          return
        }
        if (result.status === 'failed') {
          setError(`LINE 送信に失敗しました: ${result.sendError ?? '不明なエラー'}`)
          return
        }
        if (result.status === 'skipped_unlinked') {
          setError('LINE グループが紐付いていないため送信していません')
          return
        }
        setResentId(reportId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '再送に失敗しました')
      }
    })
  }

  return (
    <div className="mt-[9px] flex flex-col gap-2">
      <p className="text-xs text-ink-meta">支払報告の履歴</p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const status = STATUS_LABEL[row.status]
          return (
            <li
              key={row.id}
              className="flex flex-col gap-1 border-t border-border-soft pt-[7px] first:border-t-0 first:pt-0"
            >
              <div className="flex items-baseline gap-2 text-[13px] text-ink">
                <span className="tabular-nums">{formatDateTimeShort(row.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  {row.createdByName ?? '不明'}
                </span>
                <span className={`flex-none text-xs ${status.tone}`}>{status.text}</span>
              </div>
              <div className="flex items-baseline gap-2 text-xs text-ink-meta">
                <span className="tabular-nums">
                  {row.amountJpy != null ? `${row.amountJpy.toLocaleString('ja-JP')}円` : '金額なし'}
                </span>
                <span>証憑 {row.receiptCount}枚</span>
                <button
                  type="button"
                  className="ml-auto text-xs text-brand-fg underline disabled:no-underline disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => resend(row.id)}
                >
                  再送
                </button>
              </div>
              {row.receiptTokens.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {row.receiptTokens.map((token) => (
                    // next/image は使わない（公開 route が bytea を直に返すだけの動的
                    // エンドポイントで、最適化を挟む意味がない）。
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={token}
                      src={`/api/line-broadcast/payment-receipts/${token}/preview`}
                      alt="振込明細"
                      className="h-14 w-14 rounded border border-border object-cover"
                    />
                  ))}
                </div>
              )}
              {resentId === row.id && (
                <p className="text-xs text-brand-fg">再送しました。</p>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
