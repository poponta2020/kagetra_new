'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { approveResultDraft } from '../../../actions'

export function ApproveResultDraftForm({
  draftId,
  defaultTournamentName,
  editionOptions,
}: {
  draftId: number
  defaultTournamentName: string
  editionOptions: Array<{ id: number; label: string }>
}) {
  const [error, setError] = useState<string | null>(null)
  const [editionSearch, setEditionSearch] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const visibleEditions = useMemo(() => {
    const query = editionSearch.normalize('NFKC').toLowerCase().trim()
    return query
      ? editionOptions.filter((edition) => edition.label.normalize('NFKC').toLowerCase().includes(query))
      : editionOptions
  }, [editionOptions, editionSearch])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await approveResultDraft(draftId, fd)
      if (result.ok) {
        router.push('/admin/mail-inbox')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-ink-2" htmlFor="tournamentName">
          大会名 <span className="text-danger-fg">*</span>
        </label>
        <input
          id="tournamentName"
          name="tournamentName"
          type="text"
          required
          defaultValue={defaultTournamentName}
          disabled={pending}
          className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-semibold text-ink-2" htmlFor="eventDate">
            開催日（任意）
          </label>
          <input
            id="eventDate"
            name="eventDate"
            type="date"
            disabled={pending}
            className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-semibold text-ink-2" htmlFor="venue">
            会場（任意）
          </label>
          <input
            id="venue"
            name="venue"
            type="text"
            disabled={pending}
            className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-ink-2" htmlFor="editionId">
          開催回（結果原本の採用先）
        </label>
        <input
          type="search"
          value={editionSearch}
          onChange={(event) => setEditionSearch(event.target.value)}
          placeholder="大会名・回次・年で検索"
          disabled={pending}
          className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
        />
        <select
          id="editionId"
          name="editionId"
          defaultValue=""
          disabled={pending}
          className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
        >
          <option value="">大会名から自動判定（曖昧なら未紐付け）</option>
          {visibleEditions.map((edition) => (
            <option key={edition.id} value={edition.id}>{edition.label}</option>
          ))}
        </select>
        <span className="text-xs text-ink-meta">既存の採用結果は承認時に上書きされません。</span>
      </div>

      {error && <p className="text-xs text-danger-fg">{error}</p>}

      <Btn kind="primary" size="md" type="submit" disabled={pending}>
        {pending ? '保存中…' : '承認して確定保存'}
      </Btn>
    </form>
  )
}
