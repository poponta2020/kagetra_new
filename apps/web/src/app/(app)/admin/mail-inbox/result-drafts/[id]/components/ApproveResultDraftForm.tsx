'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn, Pill } from '@/components/ui'
import type { Grade } from '@kagetra/shared/types'
import { approveResultDraft } from '../../../actions'
import type { ImportedGradeSummary } from '../actions'

export type ApproveResultDraftFormClass = {
  index: number
  className: string
  rawClassName: string | null
  grade: Grade | null
  participantCount: number
  matchCount: number
}

export function ApproveResultDraftForm({
  draftId,
  defaultTournamentName,
  defaultEventDate,
  classes,
  loadImportedGrades,
  editionOptions,
}: {
  draftId: number
  defaultTournamentName: string
  defaultEventDate?: string
  classes: ApproveResultDraftFormClass[]
  loadImportedGrades: (editionId: number) => Promise<ImportedGradeSummary[]>
  editionOptions: Array<{ id: number; label: string }>
}) {
  const [error, setError] = useState<string | null>(null)
  const [editionSearch, setEditionSearch] = useState('')
  const [editionId, setEditionId] = useState('')
  const [pending, startTransition] = useTransition()
  const [importLoading, startImportTransition] = useTransition()
  const router = useRouter()

  // AC-16: 全級既定 ON。edition 未選択のときの既定値でもある。
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(classes.map((cls) => cls.index)),
  )
  // AC-10 の差し替え明示（既定 OFF）。
  const [replaceGrades, setReplaceGrades] = useState<Set<Grade>>(new Set())
  const [importedGrades, setImportedGrades] = useState<ImportedGradeSummary[]>([])

  const visibleEditions = useMemo(() => {
    const query = editionSearch.normalize('NFKC').toLowerCase().trim()
    return query
      ? editionOptions.filter((edition) => edition.label.normalize('NFKC').toLowerCase().includes(query))
      : editionOptions
  }, [editionOptions, editionSearch])

  const importedGradeSet = useMemo(
    () => new Set(importedGrades.map((g) => g.grade)),
    [importedGrades],
  )

  // edition select の値が変わるたびに突合結果を取り直し、既定チェック状態を
  // 再計算する（AC-10）。空に戻したら全級 ON へ戻す（AC-16）。
  useEffect(() => {
    if (!editionId) {
      setImportedGrades([])
      setChecked(new Set(classes.map((cls) => cls.index)))
      setReplaceGrades(new Set())
      return
    }
    const parsedEditionId = Number(editionId)
    if (!Number.isInteger(parsedEditionId) || parsedEditionId <= 0) return
    startImportTransition(async () => {
      const result = await loadImportedGrades(parsedEditionId)
      setImportedGrades(result)
      const imported = new Set(result.map((g) => g.grade))
      setChecked(
        new Set(
          classes
            .filter((cls) => !(cls.grade != null && imported.has(cls.grade)))
            .map((cls) => cls.index),
        ),
      )
      setReplaceGrades(new Set())
    })
  }, [editionId, classes, loadImportedGrades])

  const toggleClass = (index: number) => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const toggleReplaceGrade = (grade: Grade) => {
    setReplaceGrades((current) => {
      const next = new Set(current)
      if (next.has(grade)) {
        next.delete(grade)
      } else {
        next.add(grade)
      }
      return next
    })
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    // AC-13: クライアント側ガード。0級選択なら submit させない。
    if (checked.size === 0) {
      setError('取り込む級を1つ以上選択してください')
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set(
      'selectedClasses',
      JSON.stringify(Array.from(checked).sort((a, b) => a - b)),
    )
    fd.set('replaceGrades', JSON.stringify(Array.from(replaceGrades)))
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
            defaultValue={defaultEventDate}
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
          value={editionId}
          onChange={(event) => setEditionId(event.target.value)}
          disabled={pending}
          className="w-full rounded border border-border bg-surface p-2 text-sm text-ink disabled:opacity-60"
        >
          <option value="">大会名から自動判定（曖昧なら未紐付け）</option>
          {visibleEditions.map((edition) => (
            <option key={edition.id} value={edition.id}>{edition.label}</option>
          ))}
        </select>
        <span className="text-xs text-ink-meta">既存の採用結果は承認時に上書きされません。</span>
        {importLoading && (
          <span className="text-[10px] text-ink-meta">取込状況を確認中…</span>
        )}
      </div>

      {classes.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-2">取り込む級</span>
          <div className="flex flex-col gap-2">
            {classes.map((cls) => {
              const isImported = cls.grade != null && importedGradeSet.has(cls.grade)
              const isChecked = checked.has(cls.index)
              const label =
                cls.rawClassName && cls.rawClassName !== cls.className
                  ? `${cls.className}（元: ${cls.rawClassName}）`
                  : cls.className
              return (
                <div
                  key={cls.index}
                  className="flex flex-col gap-1.5 rounded-md border border-border-soft p-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      id={`class-${cls.index}`}
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleClass(cls.index)}
                      disabled={pending}
                    />
                    <label
                      htmlFor={`class-${cls.index}`}
                      className="min-w-0 flex-1 truncate text-sm text-ink"
                    >
                      {label}
                    </label>
                    {cls.grade ? (
                      <Pill tone="brand" size="sm">{cls.grade}級</Pill>
                    ) : (
                      <span className="text-[10px] text-ink-meta">
                        級不明のため差し替え判定対象外
                      </span>
                    )}
                    {isImported && (
                      <Pill tone="warn" size="sm">取込済み</Pill>
                    )}
                    <span className="text-[10px] whitespace-nowrap text-ink-meta">
                      {cls.participantCount}名 / {cls.matchCount}試合
                    </span>
                  </div>

                  {isImported && isChecked && cls.grade && (
                    <div className="flex flex-col gap-1 pl-6">
                      <label className="flex items-center gap-1.5 text-xs text-ink-2">
                        <input
                          type="checkbox"
                          checked={replaceGrades.has(cls.grade)}
                          onChange={() => toggleReplaceGrade(cls.grade as Grade)}
                          disabled={pending}
                        />
                        この級を差し替える
                      </label>
                      <p className="text-[10px] text-danger-fg">
                        旧データは削除され、新しい結果に置き換わります
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger-fg">{error}</p>}

      <Btn kind="primary" size="md" type="submit" disabled={pending || checked.size === 0}>
        {pending ? '保存中…' : '承認して確定保存'}
      </Btn>
    </form>
  )
}
