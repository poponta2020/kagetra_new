'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RenewalAnswer } from '@kagetra/shared'
import { Btn } from '@/components/ui'
import { cn } from '@/lib/utils'
import { proxyAnswerAction, type ProxyAnswerState } from './actions'

/**
 * S2 代理回答ダイアログ（design-mock「代理回答」断片・AC-14）。
 *
 * design-spec「代理回答は2択だけ」— 項目の修正はここでは行わず、既存の
 * 会員編集（`MemberRow` の「会員編集」リンク）に任せる。既存のボトムシート
 * パターン（`createPortal(document.body)` + `.modal-overlay-h`）に載せる。
 */
const initialState: ProxyAnswerState = {}

export interface ProxyAnswerDialogProps {
  renewalId: number
  userId: string
  displayName: string
  onClose: () => void
}

const OPTIONS: { value: RenewalAnswer; label: string }[] = [
  { value: 'register', label: '今年度も登録する' },
  { value: 'not_register', label: '今年度は登録しない' },
]

export function ProxyAnswerDialog({ renewalId, userId, displayName, onClose }: ProxyAnswerDialogProps) {
  const [state, formAction, pending] = useActionState(proxyAnswerAction, initialState)
  const [answer, setAnswer] = useState<RenewalAnswer | null>(null)

  useEffect(() => {
    if (state.success) onClose()
    // onClose は呼び出し側で毎回新しい関数になり得るので依存に含めない
    // （成功状態が変わったときだけ 1 回閉じればよい）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="proxy-answer-dialog-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col gap-3 rounded-t-[14px] bg-surface p-4 pb-[18px] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border-strong" />
        <h2 id="proxy-answer-dialog-title" className="font-display text-base font-bold text-ink">
          {displayName} の回答を代理で記録
        </h2>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="renewalId" value={renewalId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="answer" value={answer ?? ''} />

          <div className="flex flex-col gap-2">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={answer === opt.value}
                onClick={() => setAnswer(opt.value)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-[11px] text-left text-sm font-semibold text-ink',
                  answer === opt.value ? 'border-brand shadow-[inset_0_0_0_1px_var(--kg-brand)]' : 'border-border',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-ink-meta">
            登録内容の修正は会員編集で行ってください。差分は同じ規則で出ます。
          </p>

          {state.error && (
            <p role="alert" className="text-xs text-accent-fg">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-1">
            <Btn type="button" kind="secondary" size="sm" onClick={onClose} disabled={pending}>
              やめる
            </Btn>
            <Btn type="submit" size="sm" disabled={pending || answer == null}>
              {pending ? '記録中…' : '記録する'}
            </Btn>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
