'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
  const [importError, setImportError] = useState<string | null>(null)
  // 開催回の突合リクエストの世代番号（Codex R1 修正）。開催回を素早く切り替えると
  // 前の開催回の応答が後着して選択状態を上書きし、画面には B が出ているのに A 基準の
  // 級で承認できてしまう。最新世代の応答だけを反映する。
  const importReqId = useRef(0)

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
    // 世代番号は「開催回が変わった時点」で進める（空へ戻した場合も含む）。
    // これより古い応答は破棄される。
    const reqId = ++importReqId.current
    setImportError(null)
    if (!editionId) {
      setImportedGrades([])
      setChecked(new Set(classes.map((cls) => cls.index)))
      setReplaceGrades(new Set())
      return
    }
    const parsedEditionId = Number(editionId)
    if (!Number.isInteger(parsedEditionId) || parsedEditionId <= 0) return
    startImportTransition(async () => {
      try {
        const result = await loadImportedGrades(parsedEditionId)
        if (importReqId.current !== reqId) return // 古い応答は捨てる
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
      } catch (err) {
        if (importReqId.current !== reqId) return
        // 突合できないまま承認させない（既取込級を二重登録する経路になる）。
        setImportedGrades([])
        setImportError(
          `開催回の取込状況を確認できませんでした。画面を再読み込みしてください。（${
            err instanceof Error ? err.message : String(err)
          }）`,
        )
      }
    })
  }, [editionId, classes, loadImportedGrades])

  const toggleClass = (index: number) => {
    const next = new Set(checked)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setChecked(next)
    // 差し替えチェックは「取込済み級を再選択したとき」だけ画面に出る。級を外すと
    // チェックボックスは消えるのに replaceGrades には残り、送信時にサーバーが
    // 「取り込む級の中にその級が無い」と拒否して承認不能になる（Codex R1 修正）。
    // 外した時点で、その級を選んでいるクラスが他に無ければ replaceGrades からも落とす。
    const stillCheckedGrades = new Set(
      classes.flatMap((cls) =>
        next.has(cls.index) && cls.grade != null ? [cls.grade] : [],
      ),
    )
    setReplaceGrades((current) => {
      const filtered = new Set([...current].filter((grade) => stillCheckedGrades.has(grade)))
      return filtered.size === current.size ? current : filtered
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
    // 突合が終わる前・失敗したままの承認は、既取込級の二重登録につながるので止める。
    if (importLoading) {
      setError('開催回の取込状況を確認中です。完了までお待ちください')
      return
    }
    if (importError !== null) {
      setError(importError)
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set(
      'selectedClasses',
      JSON.stringify(Array.from(checked).sort((a, b) => a - b)),
    )
    // 送信直前にも現在の選択と突き合わせる（状態遷移の取りこぼしに対する保険）。
    const checkedGrades = new Set(
      classes.flatMap((cls) => (checked.has(cls.index) && cls.grade != null ? [cls.grade] : [])),
    )
    fd.set(
      'replaceGrades',
      JSON.stringify(Array.from(replaceGrades).filter((grade) => checkedGrades.has(grade))),
    )
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

      {classes.length === 0 && (
        <p className="text-xs text-danger-fg">
          解析結果に取り込める級がありません。却下してメール詳細から再取込してください。
        </p>
      )}

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

      {importError && <p className="text-xs text-danger-fg">{importError}</p>}
      {error && <p className="text-xs text-danger-fg">{error}</p>}

      <Btn
        kind="primary"
        size="md"
        type="submit"
        disabled={pending || checked.size === 0 || importLoading || importError !== null}
      >
        {pending ? '保存中…' : '承認して確定保存'}
      </Btn>
    </form>
  )
}
