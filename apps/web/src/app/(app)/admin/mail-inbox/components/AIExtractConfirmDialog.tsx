'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { triggerExtractDraft } from '../actions'

/**
 * mail-inbox-mailer タスク4: 「会で流す（AI 抽出）」確認ダイアログ。
 *
 * 要件 §3.2.5 のコスト管理: 確認ダイアログで誤タップ防止。
 *
 * 「会で流す」ボタンを押す → ダイアログ表示 → 「はい」で triggerExtractDraft、
 * 「いいえ」でクローズ。確定後は router.refresh() で詳細画面の RSC を再取得し、
 * ExtractionInProgressCard 表示に切り替わる。失敗時はインライン error 表示。
 */
export function AIExtractConfirmDialog({
  mailId,
  buttonLabel = '会で流す（AI 抽出）',
  buttonKind = 'primary',
}: {
  mailId: number
  buttonLabel?: string
  buttonKind?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const onConfirm = () => {
    setError(null)
    startTransition(async () => {
      const result = await triggerExtractDraft(mailId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Btn kind={buttonKind} size="md" onClick={() => setOpen(true)} disabled={pending}>
        {buttonLabel}
      </Btn>
      {open && (
        // mail-inbox-mailer: shadcn/ui の Dialog がまだ無いので、最小限の overlay
        // で組む。inert 属性は使わず、aria-modal / role=dialog で読み上げに対応。
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-extract-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-surface p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ai-extract-confirm-title" className="font-display text-base font-bold text-ink">
              AI で抽出します
            </h2>
            <p className="mt-2 text-sm text-ink-2">
              このメールを大会案内として AI で抽出し、ドラフトを作ります。よろしいですか？
              （完了後に通知します）
            </p>
            {error && (
              <p className="mt-2 text-xs text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Btn
                kind="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                いいえ
              </Btn>
              <Btn kind="primary" size="sm" onClick={onConfirm} disabled={pending}>
                {pending ? '送信中…' : 'はい'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
