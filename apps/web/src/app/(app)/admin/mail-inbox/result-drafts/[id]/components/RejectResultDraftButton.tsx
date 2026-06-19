'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { rejectResultDraft } from '../../../actions'

export function RejectResultDraftButton({ draftId }: { draftId: number }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const handleReject = () => {
    setError(null)
    startTransition(async () => {
      const result = await rejectResultDraft(draftId, reason)
      if (result.ok) {
        router.push('/admin/mail-inbox')
      } else {
        setError(result.error)
      }
    })
  }

  if (!open) {
    return (
      <Btn kind="ghost" size="md" onClick={() => setOpen(true)}>
        却下
      </Btn>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-danger-fg/30 bg-danger-bg p-3">
      <p className="text-sm font-semibold text-danger-fg">却下理由を入力してください</p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        rows={3}
        className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
        placeholder="例: ヘッダが読み取れなかったため"
      />
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      <div className="flex gap-2">
        <Btn kind="danger" size="md" onClick={handleReject} disabled={pending || !reason.trim()}>
          {pending ? '処理中…' : '却下確定'}
        </Btn>
        <Btn kind="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
          キャンセル
        </Btn>
      </div>
    </div>
  )
}
