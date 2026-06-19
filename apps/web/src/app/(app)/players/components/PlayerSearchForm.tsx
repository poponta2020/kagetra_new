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
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="選手名で検索"
        className="min-w-0 flex-1 rounded border border-border bg-surface p-2 text-sm text-ink"
        aria-label="選手名"
      />
      <Btn kind="primary" size="md" type="submit">
        検索
      </Btn>
    </form>
  )
}
