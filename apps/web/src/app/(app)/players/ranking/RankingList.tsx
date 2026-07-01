'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { RankingMetric, RankingRow } from '@/lib/stats/ranking'
import type { StatsFilter } from '@/lib/stats/types'
import { formatMetricSub, formatMetricValue, metricDef } from './metrics'
import { loadMoreRanking } from './actions'

/**
 * 順位リスト（design-spec §3.1.4）。
 * `[順位 | 氏名＋所属 | 指標値＋単位＋副次 | ›]` の行を並べ、行タップで戦績詳細へ。
 * TOP 100（サーバー初期表示）＋「もっと見る」で `loadMoreRanking` を呼んで追記する。
 * 同値は同順位（rank はサーバー算出＝タイの次は飛ばす）。長名は省略記号。
 *
 * 初期行はサーバーから props で受け取り、追加分だけクライアントで持つ。metric/filter が
 * 変わると page 側の `key` で再マウントされ、初期行が入れ替わる。
 */
export function RankingList({
  initialRows,
  total,
  metric,
  filter,
}: {
  initialRows: RankingRow[]
  total: number
  metric: RankingMetric
  filter: StatsFilter
}) {
  const [rows, setRows] = useState<RankingRow[]>(initialRows)
  const [loading, setLoading] = useState(false)
  const unit = metricDef(metric).unit

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-meta">
        該当する選手がいません。
      </p>
    )
  }

  const hasMore = rows.length < total

  const loadMore = async () => {
    setLoading(true)
    try {
      const more = await loadMoreRanking(metric, filter, rows.length)
      setRows((prev) => [...prev, ...more])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y divide-border-soft">
        {rows.map((r) => {
          const sub = formatMetricSub(metric, r.sub)
          return (
            <li key={r.playerId}>
              <Link
                href={`/players/${r.playerId}`}
                className="flex items-center gap-3 py-2.5 hover:bg-surface-alt"
              >
                <span className="w-8 shrink-0 text-right font-display text-lg font-bold text-ink tabular-nums">
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[15px] text-ink">
                    {r.displayName}
                  </span>
                  <span className="block truncate text-xs text-ink-meta">
                    {r.affiliation ?? '所属不明'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-display text-lg font-bold text-brand tabular-nums">
                    {formatMetricValue(metric, r.value)}
                    <span className="ml-0.5 text-xs font-normal text-ink-meta">
                      {unit}
                    </span>
                  </span>
                  {sub ? (
                    <span className="block text-[11px] text-ink-muted tabular-nums">
                      {sub}
                    </span>
                  ) : null}
                </span>
                <span aria-hidden className="shrink-0 text-ink-muted">
                  ›
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-3 self-center rounded-full border border-border bg-surface px-6 py-2 text-sm font-medium text-brand hover:bg-brand-bg disabled:opacity-50"
        >
          {loading ? '読み込み中…' : 'もっと見る'}
        </button>
      ) : null}
    </div>
  )
}
