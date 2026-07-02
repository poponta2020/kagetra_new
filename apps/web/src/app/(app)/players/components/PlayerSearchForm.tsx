'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Btn } from '@/components/ui'

/**
 * 選手名の検索フォーム。submit で /players?q=... に遷移してサーバー側検索を
 * 走らせる（結果はサーバーコンポーネントが描画）。
 */
export function PlayerSearchForm({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery)
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = value.trim()
    router.push(trimmed ? `/players?q=${encodeURIComponent(trimmed)}` : '/players')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      {/* washi 調整（design-spec §4）：検索アイコンを内包し角丸 8px（rounded-lg）。 */}
      <div className="relative min-w-0 flex-1">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="選手名で検索"
          className="w-full rounded-lg border border-border bg-surface py-[9px] pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted"
          aria-label="選手名"
        />
      </div>
      <Btn kind="primary" size="md" type="submit">
        検索
      </Btn>
    </form>
  )
}
