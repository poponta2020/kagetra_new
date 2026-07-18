'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Btn, Card } from '@/components/ui'
import {
  searchSeriesCandidates,
  type SeriesRow,
  type TournamentKind,
} from '@/lib/edition/match'

export interface TournamentSeriesSelection {
  query: string
  seriesId: number | null
  createNew: boolean
}

export function TournamentSeriesSelectSheet({
  open,
  kind,
  seriesOptions,
  selection,
  onConfirm,
  onClose,
}: {
  open: boolean
  kind: TournamentKind
  seriesOptions: SeriesRow[]
  selection: TournamentSeriesSelection
  onConfirm: (selection: TournamentSeriesSelection) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(selection.query)
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(
    selection.seriesId,
  )
  const [createNew, setCreateNew] = useState(selection.createNew)

  useEffect(() => {
    if (!open) return
    setQuery(selection.query)
    setSelectedSeriesId(selection.seriesId)
    setCreateNew(selection.createNew)
  }, [open, selection])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const candidates = useMemo(
    () => searchSeriesCandidates(query, seriesOptions, kind),
    [kind, query, seriesOptions],
  )
  const trimmedQuery = query.trim()
  const canCreateNew = trimmedQuery !== '' && candidates.length === 0
  const kindLabel = kind === 'team' ? '団体戦' : '個人戦'

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="series-select-sheet-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0">
          <h2
            id="series-select-sheet-title"
            className="font-display text-base font-bold text-ink"
          >
            大会系列を検索
          </h2>
          <p className="mt-1 text-xs text-ink-meta">
            {kindLabel}の系列だけを表示します。正準名または別名で検索できます。
          </p>
          <label className="mt-3 block text-xs font-semibold text-ink-meta">
            系列名・別名
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedSeriesId(null)
                setCreateNew(false)
              }}
              placeholder="例: シニア、山形 酒田"
              className="mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-meta focus:outline-none focus:ring-2 focus:ring-brand/30"
              autoFocus
            />
          </label>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {candidates.length > 0 ? (
            candidates.map(({ series, matchedAlias }) => {
              const checked = selectedSeriesId === series.id
              return (
                <label
                  key={series.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                    checked
                      ? 'border-brand bg-brand-bg'
                      : 'border-border-soft bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="tournament-series-candidate"
                    value={series.id}
                    checked={checked}
                    onChange={() => {
                      setSelectedSeriesId(series.id)
                      setCreateNew(false)
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-ink">
                      {series.name}
                    </span>
                    {matchedAlias && (
                      <span className="mt-0.5 block break-words text-xs text-ink-meta">
                        一致した別名: {matchedAlias}
                      </span>
                    )}
                  </span>
                </label>
              )
            })
          ) : (
            <Card>
              <div className="flex flex-col gap-3 py-2 text-sm">
                <p className="text-center text-ink-meta">
                  一致する既存系列がありません
                </p>
                {canCreateNew && (
                  <label className="flex items-start gap-2 rounded-md border border-border-soft p-3 text-ink">
                    <input
                      type="checkbox"
                      checked={createNew}
                      onChange={(event) => {
                        setCreateNew(event.target.checked)
                        if (event.target.checked) setSelectedSeriesId(null)
                      }}
                      className="mt-0.5 rounded border-border"
                    />
                    <span>
                      「{trimmedQuery}」を新しい系列として作成する
                      <span className="mt-1 block text-xs text-ink-meta">
                        既存系列にないことを確認して選択してください。
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-border-soft pt-3">
          <button
            type="button"
            onClick={() =>
              onConfirm({ query: trimmedQuery, seriesId: null, createNew: false })
            }
            className="text-xs font-medium text-ink-meta underline disabled:opacity-40"
            disabled={selectedSeriesId == null && !createNew}
          >
            選択を解除
          </button>
          <div className="flex gap-2">
            <Btn kind="ghost" size="sm" onClick={onClose}>
              キャンセル
            </Btn>
            <Btn
              kind="primary"
              size="sm"
              onClick={() =>
                onConfirm({
                  query: trimmedQuery,
                  seriesId: selectedSeriesId,
                  createNew: canCreateNew && createNew,
                })
              }
              disabled={selectedSeriesId == null && !(canCreateNew && createNew)}
            >
              この系列を使う
            </Btn>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
