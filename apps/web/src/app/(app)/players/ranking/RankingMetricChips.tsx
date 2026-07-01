import Link from 'next/link'
import type { RankingMetric } from '@/lib/stats/ranking'
import type { StatsFilter } from '@/lib/stats/types'
import { cn } from '@/lib/utils'
import { RANKING_METRICS, buildRankingHref } from './metrics'

/**
 * 指標切替チップ（design-spec §3.1.1）。横スクロールの 6 チップ、選択中＝藍 bg。
 * 各チップは現在のフィルタを保ったまま `?metric=` を差し替える Link なので、
 * クライアント JS 無しで動く（サーバーコンポーネントから描画可）。
 */
export function RankingMetricChips({
  metric,
  filter,
}: {
  metric: RankingMetric
  filter: StatsFilter
}) {
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="指標"
    >
      {RANKING_METRICS.map((m) => {
        const active = m.key === metric
        return (
          <Link
            key={m.key}
            href={buildRankingHref(m.key, filter)}
            role="tab"
            aria-selected={active}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-brand bg-brand text-white'
                : 'border-border bg-surface text-ink-meta hover:bg-surface-alt',
            )}
          >
            {m.chip}
          </Link>
        )
      })}
    </div>
  )
}
