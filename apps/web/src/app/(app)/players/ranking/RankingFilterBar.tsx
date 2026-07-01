'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RankingMetric } from '@/lib/stats/ranking'
import type { Grade, StatsFilter } from '@/lib/stats/types'
import { cn } from '@/lib/utils'
import { buildRankingHref } from './metrics'

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

function periodLabel(filter: StatsFilter): string {
  const { yearFrom, yearTo } = filter
  if (yearFrom != null && yearTo != null) {
    return yearFrom === yearTo ? `${yearFrom}` : `${yearFrom}〜${yearTo}`
  }
  if (yearFrom != null) return `${yearFrom}〜`
  if (yearTo != null) return `〜${yearTo}`
  return '全期間'
}

function gradeLabel(filter: StatsFilter): string {
  return filter.grades && filter.grades.length > 0 ? filter.grades.join('・') : '全級'
}

/**
 * 1行フィルタ（design-spec §3.1.2）：現在の期間・級のサマリーを出し、右端の
 * 「絞り込み」でボトムシートを開く。期間（年 from–to）と級（A–E 複数）を選んで
 * 「適用」すると、指標を保ったまま `?yearFrom=...&grades=...` へ遷移する。
 *
 * シート開閉と下書き（draft）状態のみを持つクライアントコンポーネント。適用/クリアは
 * URL 遷移（サーバー再集計）に委ねる＝アプリ状態の単一ソースは searchParams。
 */
export function RankingFilterBar({
  metric,
  filter,
  years,
}: {
  metric: RankingMetric
  filter: StatsFilter
  /** 期間セレクトの候補（降順・収録開始〜当年）。 */
  years: number[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState<number | undefined>(filter.yearFrom)
  const [draftTo, setDraftTo] = useState<number | undefined>(filter.yearTo)
  const [draftGrades, setDraftGrades] = useState<Grade[]>(filter.grades ?? [])

  // シートを開くたびに現在のフィルタで下書きを同期（前回のキャンセル分を破棄）。
  useEffect(() => {
    if (open) {
      setDraftFrom(filter.yearFrom)
      setDraftTo(filter.yearTo)
      setDraftGrades(filter.grades ?? [])
    }
  }, [open, filter.yearFrom, filter.yearTo, filter.grades])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const toggleGrade = (g: Grade) =>
    setDraftGrades((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    )

  const apply = () => {
    const next: StatsFilter = {}
    if (draftFrom != null) next.yearFrom = draftFrom
    if (draftTo != null) next.yearTo = draftTo
    if (draftGrades.length > 0) next.grades = draftGrades
    setOpen(false)
    router.push(buildRankingHref(metric, next))
  }

  const clear = () => {
    setOpen(false)
    router.push(buildRankingHref(metric, {}))
  }

  return (
    <>
      <div className="flex items-center gap-3 text-[13px] text-ink-meta">
        <span>
          期間 <span className="text-ink">{periodLabel(filter)}</span>
        </span>
        <span>
          級 <span className="text-ink">{gradeLabel(filter)}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="ml-auto rounded-full border border-border px-3 py-1 font-medium text-brand hover:bg-brand-bg"
        >
          絞り込み
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="絞り込み"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full flex-col gap-4 rounded-t-2xl bg-surface p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">絞り込み</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="text-xl leading-none text-ink-meta hover:text-ink"
              >
                ×
              </button>
            </header>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-ink-meta">期間（年）</h3>
              <div className="flex items-center gap-2">
                <select
                  aria-label="開始年"
                  value={draftFrom ?? ''}
                  onChange={(e) =>
                    setDraftFrom(e.target.value ? Number(e.target.value) : undefined)
                  }
                  className="min-w-0 flex-1 rounded border border-border bg-surface p-2 text-sm text-ink"
                >
                  <option value="">指定なし</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="text-ink-meta">〜</span>
                <select
                  aria-label="終了年"
                  value={draftTo ?? ''}
                  onChange={(e) =>
                    setDraftTo(e.target.value ? Number(e.target.value) : undefined)
                  }
                  className="min-w-0 flex-1 rounded border border-border bg-surface p-2 text-sm text-ink"
                >
                  <option value="">指定なし</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-ink-meta">級</h3>
              <div className="flex gap-2">
                {GRADES.map((g) => {
                  const on = draftGrades.includes(g)
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGrade(g)}
                      aria-pressed={on}
                      className={cn(
                        'flex-1 rounded-lg border py-2 text-sm font-medium transition-colors',
                        on
                          ? 'border-brand bg-brand text-white'
                          : 'border-border bg-surface text-ink-meta hover:bg-surface-alt',
                      )}
                    >
                      {g}
                    </button>
                  )
                })}
              </div>
            </section>

            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={clear}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink-meta hover:bg-surface-alt"
              >
                クリア
              </button>
              <button
                type="button"
                onClick={apply}
                className="ml-auto rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
              >
                適用
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
