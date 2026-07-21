'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { triggerRosterParse } from '../actions'

export interface RosterParseSource {
  attachmentId: number | null
  label: string
}

export function RosterParseButton({
  mailId,
  sources,
}: {
  mailId: number
  sources: RosterParseSource[]
}) {
  const [sourceKey, setSourceKey] = useState(
    sources[0]?.attachmentId == null ? 'body' : String(sources[0].attachmentId),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (sources.length === 0) return null

  const submit = () => {
    setError(null)
    const attachmentId = sourceKey === 'body' ? null : Number(sourceKey)
    startTransition(async () => {
      const result = await triggerRosterParse(mailId, attachmentId)
      if (result.ok) router.refresh()
      else setError(result.error)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-ink-2" htmlFor="roster-source">
        解析する原本
      </label>
      <select
        id="roster-source"
        value={sourceKey}
        onChange={(event) => setSourceKey(event.target.value)}
        disabled={pending}
        className="w-full rounded border border-border bg-surface p-2 text-sm text-ink"
      >
        {sources.map((source) => (
          <option
            key={source.attachmentId == null ? 'body' : source.attachmentId}
            value={source.attachmentId == null ? 'body' : source.attachmentId}
          >
            {source.label}
          </option>
        ))}
      </select>
      <Btn kind="primary" size="md" onClick={submit} disabled={pending}>
        {pending ? '登録中…' : '名簿として解析'}
      </Btn>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
