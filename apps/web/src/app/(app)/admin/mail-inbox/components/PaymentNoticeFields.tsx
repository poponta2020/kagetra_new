'use client'

import { useMemo } from 'react'
import type { GradeHeadcount } from '@/lib/entry-fee'
import {
  PAYMENT_DEADLINE_KINDS,
  PAYMENT_DEADLINE_KIND_LABELS,
  type PaymentDeadlineKind,
} from '@/lib/events/payment-deadline'
import { buildPaymentNoticeMessages } from '@/lib/payment-notice'
import { formatDateTimeShort } from '@/lib/event-date'
import type { PaymentNoticeDraft } from '../payment-notice-actions'

/**
 * 統合処理フォームの「会計へ振込連絡を送る」セクション（line-bot-message-revamp §3.3.5）。
 *
 * 描くかどうか（種別＝確定名簿 ∧ グループ選択済み）は呼び出し側が決め、ここは
 * 描かれた時点で「出してよい」前提に立つ。**送信できないときも消さず、理由を
 * 1行で出して送信だけを不可にする**（§3.3.5.2）。
 *
 * ★編集できるのは**級ごとの人数だけ**。単価は協会規定額から `resolveEntryFee` が
 * 導出する値なので、入力欄を置いてはならない（AC-37）。
 *
 * ★client 経路なので、import してよいのは pure なモジュールだけ
 * （`@/lib/payment-notice` / `@/lib/events/payment-deadline`）。`server-only` /
 * `@kagetra/shared/schema` / `drizzle-orm` を型ごと持ち込むと `next build` で
 * 初めて壊れる（requirements §6）。
 */

export interface PaymentNoticeFieldsProps {
  draft: PaymentNoticeDraft
  /** 送信チェック。OFF でも支払締切・振込先は保存される（§3.3.5.3）。 */
  send: boolean
  onSendChange: (next: boolean) => void
  /** 級 -> 人数。 */
  counts: Record<string, number>
  onCountsChange: (next: Record<string, number>) => void
  paymentDeadline: string
  onPaymentDeadlineChange: (next: string) => void
  paymentDeadlineKind: PaymentDeadlineKind
  onPaymentDeadlineKindChange: (next: PaymentDeadlineKind) => void
  paymentInfo: string
  onPaymentInfoChange: (next: string) => void
  disabled: boolean
}

const NUMBER_INPUT_CLASS =
  'w-16 rounded-md border border-border-soft bg-surface px-2 py-1 text-right text-sm text-ink'

export function PaymentNoticeFields({
  draft,
  send,
  onSendChange,
  counts,
  onCountsChange,
  paymentDeadline,
  onPaymentDeadlineChange,
  paymentDeadlineKind,
  onPaymentDeadlineKindChange,
  paymentInfo,
  onPaymentInfoChange,
  disabled,
}: PaymentNoticeFieldsProps) {
  const editedRows: GradeHeadcount[] = useMemo(
    () =>
      draft.rows.map((r) => ({
        grade: r.grade,
        count: counts[r.grade] ?? 0,
        unitJpy: r.unitJpy,
      })),
    [draft.rows, counts],
  )

  const preview = useMemo(
    () =>
      buildPaymentNoticeMessages({
        // プレビューは素テキストの `@会計`（実送信では会計担当がメンションされる）。
        mention: { kind: 'users', userIds: [] },
        rows: editedRows,
        paymentDeadlineIso: paymentDeadline || null,
        paymentInfo: paymentInfo.trim() || null,
      }),
    [editedRows, paymentDeadline, paymentInfo],
  )

  // 送信できない状態では入力欄ごと出さない（保存もサーバー側で受け付けないため、
  // 入力させると「入れたのに何も起きない」になる）。理由だけを出す（§3.3.5.2）。
  if (!draft.canSend) {
    return (
      <div className="mt-1.5 rounded-md border border-border bg-neutral-bg px-2.5 py-2 text-xs leading-relaxed text-neutral-fg">
        振込連絡は送れません: {draft.unavailableMessage}
      </div>
    )
  }

  return (
    <>
      <label className="mt-2 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={send}
          disabled={disabled}
          onChange={(e) => onSendChange(e.target.checked)}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1 text-sm text-ink">
          会計へ振込連絡を送る
          <span className="block text-[10px] font-normal text-ink-meta">
            {draft.lastSentAt
              ? `送信済 ${formatDateTimeShort(draft.lastSentAt)}。入れるともう一度送ります`
              : '@会計 へ振込金額を LINE で連絡します'}
          </span>
        </span>
      </label>

      {/* ★チェックを外したときは中身を畳むだけ。入力済みの支払締切・振込先は
          そのまま保存される（§3.3.5.3）。 */}
      {send && (
        <div className="pl-6">
          <div className="mt-2 space-y-1.5">
            {draft.rows.map((row) => (
              <div key={row.grade} className="flex items-center gap-2 text-sm">
                <span className="w-10 text-ink">{row.grade}級</span>
                {/* 単価は表示のみ。入力欄にしない（AC-37）。 */}
                <span className="w-20 text-ink-2">{row.unitJpy.toLocaleString('ja-JP')}円</span>
                <span className="text-ink-meta">×</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={counts[row.grade] ?? 0}
                  disabled={disabled}
                  onChange={(e) =>
                    onCountsChange({
                      ...counts,
                      [row.grade]: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  aria-label={`${row.grade}級の人数`}
                  className={NUMBER_INPUT_CLASS}
                />
                <span className="text-ink-meta">名</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-meta">
            人数は
            {draft.hasSavedCounts ? '前回送信時の値' : '出欠回答の集計'}
            を初期値にしています。抽選のある大会では落選者が混ざるので、送る前に確認してください。
          </p>

          <label className="mt-2.5 block text-[10px] text-ink-meta" htmlFor="pn-deadline">
            振込期限
          </label>
          <div className="mt-1 flex gap-1.5">
            <input
              id="pn-deadline"
              type="date"
              value={paymentDeadline}
              disabled={disabled}
              onChange={(e) => onPaymentDeadlineChange(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border-soft bg-surface px-2.5 py-2 text-sm text-ink"
            />
            <select
              value={paymentDeadlineKind}
              disabled={disabled || paymentDeadline !== ''}
              onChange={(e) => onPaymentDeadlineKindChange(e.target.value as PaymentDeadlineKind)}
              aria-label="振込期限の状態"
              className="flex-none rounded-md border border-border-soft bg-surface px-2 py-2 text-sm text-ink"
            >
              {PAYMENT_DEADLINE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PAYMENT_DEADLINE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-[10px] text-ink-meta">
            空でも送れます（1通目の日付行が消えるだけです）。
          </p>

          <label className="mt-2.5 block text-[10px] text-ink-meta" htmlFor="pn-info">
            振込先
          </label>
          <textarea
            id="pn-info"
            value={paymentInfo}
            rows={3}
            disabled={disabled}
            onChange={(e) => onPaymentInfoChange(e.target.value)}
            placeholder="例: 〇〇銀行 △△支店 普通 1234567 カルタ タロウ"
            className="mt-1 w-full resize-none rounded-md border border-border-soft bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
          <p className="mt-1 text-[10px] leading-relaxed text-ink-meta">
            入力した振込期限・振込先は、この大会の全ての開催日に保存されます。
          </p>
          {paymentInfo.trim() === '' && (
            <p className="mt-1 text-[10px] text-danger" role="alert">
              振込先を入力してください（2通目が送られず連絡として成立しません）。
            </p>
          )}

          <p className="mt-2.5 text-[10px] text-ink-meta">プレビュー</p>
          {preview == null ? (
            <p role="alert" className="mt-1 text-[10px] text-danger">
              人数が全級0名です。1名以上にしないと送信できません。
            </p>
          ) : (
            <div className="mt-1 space-y-1.5">
              {preview.messages.map((m, i) => (
                <pre
                  key={i}
                  className="whitespace-pre-wrap rounded-md bg-surface-alt p-2.5 text-[11px] leading-relaxed text-ink"
                >
                  {m.text}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
