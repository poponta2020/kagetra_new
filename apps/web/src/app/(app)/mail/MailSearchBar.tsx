'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * member-mail-search タスク4: `/mail` の検索バー（requirements.md §3.3・design-spec.md §7）。
 * submit で `/mail?q=...`（`att` は維持）へ `router.push`。✕ で `q` をクリア、トグルで `att`
 * を付け外す。件数表示は `players/page.tsx` の検索バーと同じ「サーバー算出値を props で
 * 受けるだけ」の方針（クライアント側では再計算しない）。
 */
export function MailSearchBar({
  initialQuery,
  attachmentsOnly,
  total,
}: {
  initialQuery: string
  attachmentsOnly: boolean
  total: number
}) {
  const [value, setValue] = useState(initialQuery)
  const router = useRouter()

  const navigate = (q: string, att: boolean) => {
    const params = new URLSearchParams()
    const trimmed = q.trim()
    if (trimmed) params.set('q', trimmed)
    if (att) params.set('att', '1')
    const qs = params.toString()
    router.push(qs ? `/mail?${qs}` : '/mail')
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    navigate(value, attachmentsOnly)
  }

  const handleClear = () => {
    setValue('')
    navigate('', attachmentsOnly)
  }

  const handleToggle = () => {
    navigate(value, !attachmentsOnly)
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-[7px]"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-ink-meta"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="件名・本文・添付から探す"
          aria-label="検索キーワード"
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="検索キーワードをクリア"
            className="shrink-0 px-0.5 text-[13px] text-ink-meta"
          >
            ✕
          </button>
        ) : null}
      </form>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-ink-meta">{total} 件</span>
        <button
          type="button"
          onClick={handleToggle}
          aria-pressed={attachmentsOnly}
          className={cn(
            'inline-flex items-center gap-[5px] rounded-full border py-[3px] pr-[10px] pl-[7px] text-[10px] font-medium',
            attachmentsOnly
              ? 'border-brand bg-brand-bg text-brand-fg'
              : 'border-border bg-surface text-ink-2',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-xs border text-[9px] leading-none',
              attachmentsOnly
                ? 'border-brand bg-brand text-ink-on-brand'
                : 'border-border-strong bg-surface text-transparent',
            )}
          >
            ✓
          </span>
          添付ありのみ
        </button>
      </div>
    </div>
  )
}
