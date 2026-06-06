'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { undoTriage, unlinkMailFromEvent } from '../actions'

/**
 * mail-inbox-mailer タスク4: 処理済画面の「未処理に戻す」ボタン。
 *
 * 要件 §3.1.8:
 *   - triage_status を 'processed' → 'unprocessed'
 *   - linked_event_id がある場合は NULL に戻す（LINE 配信済メッセージの取消は
 *     LINE API 仕様上不可なので、紐付けだけ外す）
 *   - AI 抽出済み draft は残す（再度開けば編集可）
 *
 * undoTriage（triage のみ）と unlinkMailFromEvent（linked_event_id 含む）の
 * 使い分けは呼び出し側で行う: linked_event_id があれば unlinkMailFromEvent、
 * それ以外は undoTriage。
 */
export function UndoTriageButton({
  mailId,
  hasLinkedEvent,
}: {
  mailId: number
  hasLinkedEvent: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const onUndo = () => {
    startTransition(async () => {
      if (hasLinkedEvent) {
        await unlinkMailFromEvent(mailId)
      } else {
        await undoTriage(mailId)
      }
      router.refresh()
    })
  }

  return (
    <Btn kind="secondary" size="md" onClick={onUndo} disabled={pending}>
      {pending ? '処理中…' : '未処理に戻す'}
    </Btn>
  )
}
