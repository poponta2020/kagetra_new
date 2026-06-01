'use client'

import { useTransition } from 'react'
import { Btn } from '@/components/ui'
import { deferMail, dismissMail, undoTriage } from '../actions'

export type TriageStatus = 'unprocessed' | 'processed' | 'deferred'

/**
 * mail-triage-badge: メール1件のトリアージ操作ボタン群（client）。
 *
 * 一覧カード・詳細ページの双方から使う。triage_status に応じて出すボタンを
 * 切り替える:
 *   - unprocessed → [対応不要][保留]
 *   - deferred    → [対応不要][未処理に戻す]
 *   - processed   → [未処理に戻す]
 *
 * Server Action 実行中は useTransition で二度押しを防ぐ。Server Action 側で
 * revalidatePath('/admin/mail-inbox') を呼ぶので、完了後に一覧/詳細が再検証され
 * バッジ（フォアグラウンド更新）もタスク4 のクライアントが拾い直す。
 */
export function TriageActions({
  mailId,
  triageStatus,
  size = 'sm',
}: {
  mailId: number
  triageStatus: TriageStatus
  size?: 'sm' | 'md'
}) {
  const [pending, startTransition] = useTransition()

  const run = (fn: (id: number) => Promise<void>) => () => {
    startTransition(async () => {
      await fn(mailId)
      // mail-triage-badge: 処理後に前景バッジを即再同期（経路③）。
      // ServiceWorkerRegister が 'mail-triage-badge:sync' を購読して count API →
      // setAppBadge を呼ぶ。リスナー未登録（バッジ非対応端末）でも no-op。
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('mail-triage-badge:sync'))
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {triageStatus !== 'processed' && (
        <Btn kind="secondary" size={size} disabled={pending} onClick={run(dismissMail)}>
          対応不要
        </Btn>
      )}
      {triageStatus === 'unprocessed' && (
        <Btn kind="secondary" size={size} disabled={pending} onClick={run(deferMail)}>
          保留
        </Btn>
      )}
      {triageStatus !== 'unprocessed' && (
        <Btn kind="ghost" size={size} disabled={pending} onClick={run(undoTriage)}>
          未処理に戻す
        </Btn>
      )}
    </div>
  )
}
