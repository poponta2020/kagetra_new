'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * 大会結果 一覧の共通ヘッダ（design-spec §3.4）。年別（`/tournaments`）と大会別
 * （`/tournaments/series`）を切り替える `ss-groupseg` トグルと、両ビュー共通の大会名検索。
 * 検索は現ビューの basePath へ `?q=` 遷移＝サーバー再集計に委ね、状態の単一ソースは searchParams。
 * トグルは現在の検索語を引き継ぐ。虫眼鏡は絵文字でなく CSS/SVG 描画（design-spec §8）。
 */
export function TournamentsHeader({
  view,
  query,
}: {
  view: 'year' | 'series'
  query: string
}) {
  const router = useRouter()
  const [q, setQ] = useState(query)

  // 遷移で query プロップが変わったら入力欄も同期。
  useEffect(() => setQ(query), [query])

  const basePath = view === 'year' ? '/tournaments' : '/tournaments/series'
  const carried = query ? `?q=${encodeURIComponent(query)}` : ''

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = q.trim()
    router.push(t ? `${basePath}?q=${encodeURIComponent(t)}` : basePath)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="表示切替"
        className="flex items-stretch rounded-full border border-border bg-surface p-0.5 text-[13px]"
      >
        <ToggleLink href={`/tournaments${carried}`} active={view === 'year'} label="年別" />
        <ToggleLink
          href={`/tournaments/series${carried}`}
          active={view === 'series'}
          label="大会別"
        />
      </div>

      <form onSubmit={submit} className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="大会名で検索"
          aria-label="大会名で検索"
          className="w-full rounded-full border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted"
        />
      </form>
    </div>
  )
}

function ToggleLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        'flex flex-1 items-center justify-center rounded-full py-1.5 font-medium transition-colors',
        active ? 'bg-brand text-white' : 'text-ink-meta hover:bg-surface-alt',
      )}
    >
      {label}
    </Link>
  )
}
