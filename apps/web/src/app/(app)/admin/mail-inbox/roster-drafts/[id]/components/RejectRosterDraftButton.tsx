'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { rejectRosterImportDraft } from '../../../actions'

export function RejectRosterDraftButton({
  draftId,
  returnTo,
}: {
  draftId: number
  returnTo: string
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="failed-roster-reject-reason" className="text-xs font-semibold text-ink-2">
        却下理由
      </label>
      <textarea
        id="failed-roster-reject-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="min-h-20 rounded border border-border bg-surface p-2 text-sm text-ink"
      />
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      <Btn
        kind="danger"
        size="md"
        type="button"
        disabled={pending || !reason.trim()}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await rejectRosterImportDraft(draftId, reason)
            if (result.ok) router.push(returnTo)
            else setError(result.error)
          })
        }}
      >
        {pending ? '却下中…' : 'このドラフトを却下'}
      </Btn>
    </div>
  )
}
