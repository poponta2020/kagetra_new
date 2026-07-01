import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card } from '@/components/ui'
import { ParticipantTrendChart } from '@/components/stats/charts/ParticipantTrendChart'
import { getSeriesDetail, type SeriesEditionRow } from '@/lib/stats/series'

export const dynamic = 'force-dynamic'

/**
 * /tournaments/series/[id] — シリーズ詳細（回次一覧＋参加者数推移）。requirements §3.4・
 * design-spec §3.6。プッシュ表示のため SectionTabs は出さず戻る導線のみ。回次一覧は新しい順、
 * 結果データのある回は大会詳細へリンク、中止/記録なしは非タップで明示。
 */
export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { id } = await params
  const seriesId = Number(id)
  const detail = Number.isInteger(seriesId) ? await getSeriesDetail(seriesId) : null
  if (!detail) notFound()

  const rangeLabel =
    detail.editionNumberFrom != null && detail.editionNumberTo != null
      ? `第${detail.editionNumberFrom}〜${detail.editionNumberTo}回`
      : null
  const yearRange =
    detail.yearFrom != null && detail.yearTo != null
      ? detail.yearFrom === detail.yearTo
        ? `${detail.yearFrom}年`
        : `${detail.yearFrom}〜${detail.yearTo}年`
      : null

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link href="/tournaments/series" className="text-sm text-brand">
          ‹ 大会別一覧へ戻る
        </Link>
        <h1 className="mt-1 font-display text-xl font-bold text-ink">{detail.name}</h1>
        {(rangeLabel || yearRange) && (
          <p className="text-xs text-ink-meta">
            {[rangeLabel, yearRange].filter(Boolean).join(' ・ ')}
          </p>
        )}
      </div>

      {/* サマリー帯（通算開催回数／直近回次・年／状態内訳） */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryChip label="通算開催回数">
          <span className="font-display text-xl font-bold text-brand tabular-nums">
            {detail.heldCount}
            <span className="ml-0.5 text-xs font-normal text-ink-meta">回</span>
          </span>
        </SummaryChip>
        <SummaryChip label="直近回次">
          <span className="font-display text-base font-bold text-ink">
            {detail.editionNumberTo != null ? `第${detail.editionNumberTo}回` : '—'}
          </span>
          <span className="block text-[11px] text-ink-meta">
            {detail.yearTo != null ? `${detail.yearTo}年` : ''}
          </span>
        </SummaryChip>
        <SummaryChip label="状態内訳">
          <span className="text-xs tabular-nums text-ink">
            開催{detail.heldCount}
            {detail.cancelledCount > 0 ? (
              <span className="ml-1 text-accent-fg">中止{detail.cancelledCount}</span>
            ) : null}
            {detail.unconfirmedCount > 0 ? (
              <span className="ml-1 text-ink-muted">未確定{detail.unconfirmedCount}</span>
            ) : null}
          </span>
        </SummaryChip>
      </div>

      {/* 参加者数の推移（記録ある年＋中止年） */}
      {detail.participantTrend.length > 0 ? (
        <Card className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">参加者数の推移</h2>
          <p className="text-[11px] text-ink-meta">全級合計・記録のある年のみ（中止は朱の破線）</p>
          <ParticipantTrendChart points={detail.participantTrend} ariaLabel={`${detail.name} 参加者数の推移`} />
        </Card>
      ) : null}

      {/* 回次一覧（新しい順） */}
      <section className="flex flex-col">
        <h2 className="mb-1 border-b border-border-soft pb-1 font-display text-base font-bold text-ink">
          回次一覧
        </h2>
        <ul className="flex flex-col divide-y divide-border-soft">
          {detail.editions.map((e) => (
            <EditionRow key={e.editionId} e={e} backPath={`/tournaments/series/${detail.seriesId}`} />
          ))}
        </ul>
      </section>
    </div>
  )
}

function SummaryChip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-0.5">
      <span className="text-[11px] text-ink-meta">{label}</span>
      {children}
    </Card>
  )
}

/**
 * 回次一覧の 1 行。結果データのある回（tournamentId あり）は大会詳細へリンク、中止・記録なしは
 * 非タップで明示（design-spec §3.6.4/5）。
 */
function EditionRow({ e, backPath }: { e: SeriesEditionRow; backPath: string }) {
  const head = (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-display text-[15px] text-ink">第{e.editionNumber}回</span>
      <span className="block truncate text-xs text-ink-meta">
        {e.year != null ? `${e.year}年` : '開催年不明'}
        {e.status === 'cancelled' ? <span className="ml-1 text-accent-fg">中止</span> : null}
        {e.status === 'unconfirmed' ? <span className="ml-1 text-ink-muted">未確定</span> : null}
      </span>
    </span>
  )

  // 中止／記録なし（結果データ無し）は非タップ。
  if (e.tournamentId == null) {
    return (
      <li className="flex items-center gap-3 py-2.5">
        {head}
        <span className="shrink-0 text-right text-xs text-ink-muted">
          {e.status === 'cancelled' ? '—' : '記録なし'}
        </span>
      </li>
    )
  }

  return (
    <li>
      <Link
        href={`/tournaments/${e.tournamentId}?from=${encodeURIComponent(backPath)}`}
        className="flex items-center gap-3 py-2.5 hover:bg-surface-alt"
      >
        {head}
        <span className="shrink-0 text-right">
          {e.championName ? (
            <span className="block truncate font-display text-sm font-medium text-brand">
              {e.championName}
            </span>
          ) : null}
          {e.participantCount != null ? (
            <span className="block text-[11px] tabular-nums text-ink-meta">
              {e.participantCount}人
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
