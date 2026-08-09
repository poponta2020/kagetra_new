'use client'

import { useState } from 'react'
import { splitSearchTerms } from '@/lib/member-mail/format'
import { MailCard } from './MailCard'
import { loadMoreMails, type MailListItem } from './actions'

/**
 * member-mail-search タスク4: `/mail` の一覧本体（requirements.md §3.3・AC-8。
 * `players/ranking/RankingList.tsx` と同じ追加読込パターン）。
 *
 * サーバーから受け取った初回20件を state に持ち、「もっと読み込む」で
 * `loadMoreMails` を呼んで追記する。多重実行ガード・空配列での終端判定・
 * エラー時のボタン残存は `RankingList` と同じ方針。
 */
export function MailList({
  initialItems,
  total,
  q,
  attachmentsOnly,
  from,
}: {
  initialItems: MailListItem[]
  total: number
  q: string
  attachmentsOnly: boolean
  from: string
}) {
  const [items, setItems] = useState<MailListItem[]>(initialItems)
  const [loading, setLoading] = useState(false)
  // 追加取得が空配列を返したら終端扱いにする（total は初期表示時点のスナップショットで、
  // データ変化により items.length < total のままでも次ページが 0 件になり得るため）。
  const [exhausted, setExhausted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const terms = splitSearchTerms(q)

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
        <p className="text-[13px] text-ink-2">該当するメールがありません</p>
        {attachmentsOnly ? (
          <p className="text-[10px] leading-[1.55] text-ink-meta">
            キーワードを短くするか、「添付ありのみ」を外してみてください。
          </p>
        ) : null}
      </div>
    )
  }

  const hasMore = !exhausted && items.length < total

  const loadMore = async () => {
    if (loading) return // 多重実行ガード（連打で同じ offset のリクエストを重ねない）
    setLoading(true)
    setError(null)
    try {
      const more = await loadMoreMails(q, attachmentsOnly, items.length)
      if (more.length === 0) setExhausted(true)
      else setItems((prev) => [...prev, ...more])
    } catch {
      setError('読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <MailCard
          key={item.row.id}
          row={item.row}
          historySummary={item.historySummary}
          terms={terms}
          from={from}
        />
      ))}

      {error ? (
        <p role="alert" className="self-center text-xs text-danger-fg">
          {error}
        </p>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="self-center rounded-full border border-border bg-surface px-5 py-[7px] text-xs font-medium text-brand-fg disabled:opacity-50"
        >
          {loading ? '読み込み中…' : 'もっと読み込む'}
        </button>
      ) : null}
    </div>
  )
}
