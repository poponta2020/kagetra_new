import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SectionTabs } from '@/components/stats/section-tabs'
import { getSeriesList, type SeriesListRow } from '@/lib/stats/series'
import { TournamentsHeader } from '../TournamentsHeader'

export const dynamic = 'force-dynamic'

/**
 * /tournaments/series — ② 大会結果・大会別ビュー（シリーズ一覧・閲覧）。requirements §3.4・
 * design-spec §3.4。系列を 1 行に束ね（累計開催回数・回次範囲・直近年・状態内訳）、行タップで
 * シリーズ詳細へ。年別（`/tournaments`）とはヘッダのトグルで切替、大会名検索は両ビュー共通。
 */
export default async function TournamentSeriesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const sp = await searchParams
  const query = firstParam(sp.q)?.trim() ?? ''
  const rows = await getSeriesList(query || undefined)

  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <TournamentsHeader view="series" query={query} />
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-meta">
            該当する大会（系列）がありません。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-soft">
            {rows.map((s) => (
              <SeriesRow key={s.seriesId} s={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SeriesRow({ s }: { s: SeriesListRow }) {
  const range =
    s.editionNumberFrom != null && s.editionNumberTo != null
      ? s.editionNumberFrom === s.editionNumberTo
        ? `第${s.editionNumberFrom}回`
        : `第${s.editionNumberFrom}〜${s.editionNumberTo}回`
      : null
  return (
    <li>
      <Link
        href={`/tournaments/series/${s.seriesId}`}
        className="flex items-center gap-3 py-2.5 hover:bg-surface-alt"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[15px] text-ink">{s.name}</span>
          <span className="block truncate text-xs text-ink-meta">
            {range}
            {s.recentYear != null ? `${range ? ' ・ ' : ''}直近 ${s.recentYear}年` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {/* 累計開催回数＝実際に開催（held）した回数。中止/未確定は下の状態内訳で別掲
              （design-spec §3.6.2：通算開催回数 と 状態内訳 は別軸）＝シリーズ詳細と一致。 */}
          <span className="font-display text-base font-bold text-brand tabular-nums">
            {s.heldCount}
            <span className="ml-0.5 text-xs font-normal text-ink-meta">回</span>
          </span>
          {s.cancelledCount > 0 || s.unconfirmedCount > 0 ? (
            <span className="block text-[11px] tabular-nums">
              {s.cancelledCount > 0 ? (
                <span className="text-accent-fg">中止{s.cancelledCount}</span>
              ) : null}
              {s.cancelledCount > 0 && s.unconfirmedCount > 0 ? ' ' : ''}
              {s.unconfirmedCount > 0 ? (
                <span className="text-ink-muted">未確定{s.unconfirmedCount}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span aria-hidden className="shrink-0 text-ink-muted">
          ›
        </span>
      </Link>
    </li>
  )
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
