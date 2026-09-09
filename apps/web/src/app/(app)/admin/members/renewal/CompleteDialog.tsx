'use client'

import { useActionState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'
import { completeRenewalAction, type CompleteRenewalState } from './actions'

/**
 * S2 登録完了ダイアログ（design-mock「登録完了の確認」・AC-19）。
 *
 * 押す前に必ず 3 点を見せる: ①「登録しない」でフラグを消す人数
 * ②未回答の人数・氏名（継続扱いのまま残る） ③取り消せないこと。
 */
const initialState: CompleteRenewalState = {}

export interface CompleteDialogProps {
  renewalId: number
  turnOffCount: number
  unansweredNames: string[]
  onClose: () => void
}

export function CompleteDialog({ renewalId, turnOffCount, unansweredNames, onClose }: CompleteDialogProps) {
  const [state, formAction, pending] = useActionState(completeRenewalAction, initialState)

  useEffect(() => {
    if (state.success) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-dialog-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col gap-3 rounded-t-[14px] bg-surface p-4 pb-[18px] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border-strong" />
        <h2 id="complete-dialog-title" className="font-display text-base font-bold text-ink">
          登録完了にしますか？
        </h2>

        <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-ink-2">
          <p>
            「登録しない」と回答した <b className="text-ink">{turnOffCount}名</b> の全日協登録をオフにします。
          </p>
          <p>
            未回答 <b className="text-ink">{unansweredNames.length}名</b> はそのまま（継続扱い）です。
            {unansweredNames.length > 0 && (
              <span className="mt-1 block text-xs leading-relaxed text-ink-meta">
                {unansweredNames.join('、')}
              </span>
            )}
          </p>
          <p>これ以降、会員は回答を変更できず、未送信のリマインドは取り消されます。取り消しはできません。</p>
        </div>

        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="renewalId" value={renewalId} />
          {state.error && (
            <p role="alert" className="text-xs text-accent-fg">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2.5 pt-1">
            <Btn type="button" kind="secondary" size="sm" onClick={onClose} disabled={pending}>
              やめる
            </Btn>
            <Btn type="submit" size="sm" disabled={pending}>
              {pending ? '処理中…' : '登録完了にする'}
            </Btn>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
