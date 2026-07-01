'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { TournamentListRow } from '@/lib/stats/tournaments'
import { GradeDots } from '@/components/stats/GradeDots'
import { loadMoreTournaments } from './actions'

/**
 * 年別ビューの一覧（design-spec §3.4 年別）。累積した大会行を**年セクション**に束ね、行タップで
 * 大会詳細へ。開催日降順で来る行を年ごとにまとめる（日付不明は末尾「日付不明」節）。TOP `total`
 * を「もっと見る」で `loadMoreTournaments` により追記する。中止回は「中止」（朱）・参加「—」。
 *
 * 初期行はサーバーから props で受け取り、追加分だけクライアントで持つ。query が変わると page 側の
 * `key` で再マウントされ初期行が入れ替わる。
 */
export function TournamentYearList({
  initialRows,
  total,
  query,
}: {
  initialRows: TournamentListRow[]
  total: number
  query: string
}) {
  const [rows, setRows] = useState<TournamentListRow[]>(initialRows)
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-meta">該当する大会がありません。</p>
  }

  const hasMore = !exhausted && rows.length < total

  const loadMore = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const more = await loadMoreTournaments(query || undefined, rows.length)
      if (more.length === 0) setExhausted(true)
      else setRows((prev) => [...prev, ...more])
    } catch {
      setError('読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  // 年ごとにセクション化（rows は開催日降順で来るので出現順＝年降順・末尾に日付不明）。
  const sections: { year: number | null; rows: TournamentListRow[] }[] = []
  for (const r of rows) {
    const last = sections[sections.length - 1]
    if (last && last.year === r.year) last.rows.push(r)
    else sections.push({ year: r.year, rows: [r] })
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((sec) => (
        <section key={sec.year ?? 'unknown'} className="flex flex-col">
          <h2 className="mb-1 flex items-baseline gap-2 border-b border-border-soft pb-1">
            <span className="font-display text-lg font-bold text-ink">
              {sec.year ?? '日付不明'}
            </span>
            <span className="text-xs text-ink-meta">{sec.rows.length}大会</span>
          </h2>
          <ul className="flex flex-col divide-y divide-border-soft">
            {sec.rows.map((t) => (
              <li key={t.tournamentId}>
                <Link
                  href={`/tournaments/${t.tournamentId}`}
                  className="flex items-center gap-3 py-2.5 hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[15px] text-ink">
                      {t.name}
                    </span>
                    <span className="block truncate text-xs text-ink-meta">
                      {formatDate(t.eventDate)}
                      {t.venue ? ` ・ ${t.venue}` : ''}
                      {t.cancelled ? <span className="ml-1 text-accent-fg">中止</span> : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <GradeDots grades={t.grades} />
                    <span className="w-12 text-right text-xs tabular-nums text-ink-meta">
                      {t.cancelled ? '—' : `${t.participantCount}人`}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {error ? (
        <p role="alert" className="self-center text-xs text-accent-fg">
          {error}
        </p>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="self-center rounded-full border border-border bg-surface px-6 py-2 text-sm font-medium text-brand hover:bg-brand-bg disabled:opacity-50"
        >
          {loading ? '読み込み中…' : 'もっと見る'}
        </button>
      ) : null}
    </div>
  )
}

/** 開催日 YYYY-MM-DD → YYYY/MM/DD（design-spec §8）。null は「日付不明」。 */
function formatDate(d: string | null): string {
  if (!d) return '日付不明'
  return d.replaceAll('-', '/')
}
