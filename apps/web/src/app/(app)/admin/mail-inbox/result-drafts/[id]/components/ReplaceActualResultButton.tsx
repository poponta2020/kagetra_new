'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { replaceActualResultFact } from '../../../actions'

export function ReplaceActualResultButton({
  draftId,
  grade,
  expectedActiveFactId,
}: {
  draftId: number
  grade: 'A' | 'B' | 'C' | 'D' | 'E'
  expectedActiveFactId: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div className="flex flex-col gap-1">
      <Btn
        kind="danger"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`${grade}級の採用結果をこの訂正版へ置き換えますか？`)) return
          setError(null)
          startTransition(async () => {
            const result = await replaceActualResultFact(draftId, grade, expectedActiveFactId)
            if (result.ok) router.refresh()
            else setError(result.error)
          })
        }}
      >
        {pending ? '置換中…' : `${grade}級の採用結果を明示置換`}
      </Btn>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
