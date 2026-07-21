'use client'

import { useState } from 'react'
import { Card } from '@/components/ui'
import type {
  AGradeCutoffAggregate,
  AGradeCutoffMissingReason,
  LotteryMetricGrade,
  LotteryMetricMissingReason,
  SeriesGradeLotteryMetric,
  SeriesLotteryMetrics,
} from '@/lib/lottery/series-metrics'

const GRADES: LotteryMetricGrade[] = ['A', 'B', 'C', 'D', 'E']

const METRIC_REASON_LABELS: Record<LotteryMetricMissingReason, string> = {
  unknown_selection_status: '抽選の有無を確認できません',
  missing_applicant_roster: '申込名簿がありません',
  invalid_applicant_roster: '申込名簿と開催回の対応を確認できません',
  duplicate_applicant_entries: '申込名簿に重複候補があります',
  empty_applicant_roster: '申込名簿の人数を確認できません',
  invalid_under_capacity_count: '申込者数と級別定員の関係を確認できません',
  missing_selection_result_roster: '抽選結果発表時の確定名簿がありません',
  invalid_selection_result_roster: '抽選結果名簿と開催回の対応を確認できません',
  duplicate_selection_result_entries: '抽選結果名簿に重複候補があります',
  empty_accepted_selection_result: '抽選時確定者数を確認できません',
  unknown_selection_outcome: '当落を確認できない申込者がいます',
}

const CUTOFF_REASON_LABELS: Record<AGradeCutoffMissingReason, string> = {
  missing_rule_evidence: '適用ルールの根拠資料を確認できません',
  invalid_adopted_input: '当落線の根拠となる名簿を確認できません',
  missing_capacity: 'A級の定員がありません',
  missing_application_start_date: '申込開始日を確認できません',
  unsupported_rule_version: '適用する選考ルールを確認できません',
  unverified_exemption_classification: '主催者枠・抽選除外の確認が完了していません',
  missing_applicant_identity: '申込者の同定が完了していません',
  duplicate_applicant_identity: '申込者に重複候補があります',
  missing_selection_outcome: '当落結果を確認できない申込者がいます',
  duplicate_selection_outcome: '当落結果に重複候補があります',
  unknown_selection_outcome: '当落が未確定の申込者がいます',
  incomplete_appearance_history: '基準日時点の出場履歴が不足しています',
}

export function LotteryMetricsSection({
  metrics,
}: {
  metrics: SeriesLotteryMetrics
  /** 呼び出し側との表示文脈用。個人情報を描画契約へ追加しない。 */
  seriesName?: string
}) {
  const [grade, setGrade] = useState<LotteryMetricGrade>('A')
  const points = metrics.points
    .filter((point) => point.grade === grade)
    .sort((left, right) => left.editionNumber - right.editionNumber)
  const chartPoints = points.filter(
    (point) => point.completeness === 'complete' && point.applicantCount != null,
  )

  return (
    <Card className="flex min-w-0 flex-col gap-3 overflow-hidden">
      <div>
        <h2 className="font-display text-base font-bold text-ink">級別の申込・抽選推移</h2>
        <p className="text-[11px] text-ink-meta">
          A〜E級を切り替えて、申込規模と抽選・定員の状況を確認できます
        </p>
      </div>

      <div
        role="tablist"
        aria-label="表示する級"
        className="grid grid-cols-5 gap-1 rounded-lg bg-surface-alt p-1"
      >
        {GRADES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={grade === item}
            onClick={() => setGrade(item)}
            className={`min-h-11 rounded-md px-2 text-sm font-medium transition-colors ${
              grade === item
                ? 'bg-surface text-brand shadow-sm'
                : 'text-ink-meta hover:text-ink'
            }`}
          >
            {item}級
          </button>
        ))}
      </div>

      {metrics.points.length === 0 ? (
        <EmptyMessage>級別の申込・抽選データはまだありません</EmptyMessage>
      ) : points.length === 0 ? (
        <EmptyMessage>{grade}級のデータはありません</EmptyMessage>
      ) : (
        <>
          {chartPoints.length > 0 ? (
            <div className="min-w-0">
              <LotteryDemandTrendChart grade={grade} points={chartPoints} />
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-meta" aria-label="推移グラフの凡例">
                <li className="flex items-center gap-1">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand opacity-30" />申込者数
                </li>
                <li className="flex items-center gap-1">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-brand" />抽選時確定者数
                </li>
                <li className="flex items-center gap-1">
                  <span aria-hidden className="h-px w-3 bg-ink-muted" />級別定員
                </li>
              </ul>
            </div>
          ) : null}

          <ul aria-label={`${grade}級の開催回別内訳`} className="flex flex-col gap-3">
            {[...points].reverse().map((point) => (
              <EditionMetric key={`${point.editionNumber}-${point.year ?? 'unknown'}`} point={point} />
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-ink-muted">
      {children}
    </p>
  )
}

function EditionMetric({ point }: { point: SeriesGradeLotteryMetric }) {
  return (
    <li className="rounded-lg border border-border-soft bg-surface-alt p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-ink">第{point.editionNumber}回</h3>
          <p className="text-[11px] text-ink-meta">{point.year != null ? `${point.year}年` : '開催年不明'}</p>
        </div>
        <StatusBadge point={point} />
      </div>

      {point.completeness === 'incomplete' ? (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <p className="text-sm font-medium text-ink">データ不足</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-meta">
            {point.missingReasons.map((reason) => (
              <li key={reason}>{METRIC_REASON_LABELS[reason]}</li>
            ))}
          </ul>
        </div>
      ) : (
        <CompleteMetric point={point} />
      )}

      {point.grade === 'A' && point.completeness === 'complete' && point.aGradeCutoff != null ? (
        <AGradeCutoffDetails
          cutoff={point.aGradeCutoff}
          selectionStatus={point.selectionStatus}
        />
      ) : null}
    </li>
  )
}

function StatusBadge({ point }: { point: SeriesGradeLotteryMetric }) {
  const label = point.completeness === 'incomplete'
    ? 'データ不足'
    : point.selectionStatus === 'lottery'
      ? '抽選あり'
      : point.selectionStatus === 'under_capacity'
        ? '抽選なし'
        : point.selectionStatus === 'no_capacity'
          ? '定員なし・抽選なし'
          : '確認中'
  return (
    <span className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] font-medium text-ink-meta">
      {label}
    </span>
  )
}

function CompleteMetric({ point }: { point: SeriesGradeLotteryMetric }) {
  if (point.selectionStatus === 'lottery' && point.lotteryRatio != null) {
    return (
      <div className="mt-3">
        <p className="font-display text-2xl font-bold tabular-nums text-brand">
          {point.lotteryRatio.formatted}倍
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-meta">
          <ValueBox>申込者 {point.lotteryRatio.numerator}人</ValueBox>
          <ValueBox>抽選時確定者 {point.lotteryRatio.denominator}人</ValueBox>
        </div>
      </div>
    )
  }

  if (point.selectionStatus === 'under_capacity' && point.occupancy != null && point.remainingSlots != null) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-meta sm:grid-cols-4">
        <ValueBox>申込者 {point.occupancy.numerator}人</ValueBox>
        <ValueBox>定員 {point.occupancy.denominator}人</ValueBox>
        <ValueBox>残り {point.remainingSlots}枠</ValueBox>
        <ValueBox>定員充足率 {point.occupancy.formatted}</ValueBox>
      </div>
    )
  }

  if (point.selectionStatus === 'no_capacity' && point.applicantCount != null) {
    return (
      <div className="mt-3">
        <ValueBox>申込者 {point.applicantCount}人</ValueBox>
      </div>
    )
  }

  return null
}

function ValueBox({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface px-2 py-2 tabular-nums">{children}</p>
}

function AGradeCutoffDetails({
  cutoff,
  selectionStatus,
}: {
  cutoff: AGradeCutoffAggregate
  selectionStatus: SeriesGradeLotteryMetric['selectionStatus']
}) {
  const hasStack = cutoff.organizerSlots.applicantCount > 0 ||
    cutoff.appearanceBuckets.some((bucket) => bucket.applicantCount > 0)
  const completeCapacityLine = cutoff.completeness === 'complete' ? cutoff.capacityLine : null
  const boundary = completeCapacityLine?.boundaryAppearanceCount

  return (
    <section className="mt-4 border-t border-border-soft pt-3">
      <h4 className="font-display text-sm font-bold text-ink">A級の年度内出場回数別内訳</h4>
      <p className="text-[11px] text-ink-meta">主催者枠の後に、出場回数の少ない層から積み上げます</p>

      {hasStack ? (
        <>
          <AGradeCutoffChart cutoff={cutoff} capacityLine={completeCapacityLine} />
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-meta">
            {cutoff.organizerSlots.applicantCount > 0 ? (
              <li>主催者枠 {cutoff.organizerSlots.applicantCount}人</li>
            ) : null}
            {cutoff.appearanceBuckets.map((bucket) => (
              <li key={bucket.appearanceCount}>{bucket.appearanceCount}回 {bucket.applicantCount}人</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">回数別内訳のデータがありません</p>
      )}

      {cutoff.completeness === 'complete' && boundary != null && completeCapacityLine != null ? (
        <p className="mt-3 rounded-md bg-surface px-3 py-2 text-xs leading-relaxed text-ink">
          当落線は{boundary}回層です。申込{completeCapacityLine.applicantsInBoundary}人、
          当選{completeCapacityLine.acceptedInBoundary}人、落選・キャンセル待ち
          {(completeCapacityLine.waitlistedInBoundary ?? 0) + (completeCapacityLine.rejectedInBoundary ?? 0)}人。
        </p>
      ) : cutoff.completeness === 'complete' && completeCapacityLine != null && completeCapacityLine.remainingSlots > 0 ? (
        <p className="mt-3 rounded-md bg-surface px-3 py-2 text-xs text-ink">
          定員まで残り{completeCapacityLine.remainingSlots}枠です。
        </p>
      ) : selectionStatus === 'no_capacity' ? (
        <p className="mt-3 text-xs text-ink-meta">定員がないため当落線はありません。</p>
      ) : cutoff.completeness === 'incomplete' ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-xs font-medium text-ink">当落線はデータ不足のため表示できません</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-ink-meta">
            {cutoff.missingReasons.map((reason) => (
              <li key={reason}>{CUTOFF_REASON_LABELS[reason]}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

const SVG_WIDTH = 320

function LotteryDemandTrendChart({
  grade,
  points,
}: {
  grade: LotteryMetricGrade
  points: SeriesGradeLotteryMetric[]
}) {
  const height = 150
  const padding = { left: 30, right: 8, top: 14, bottom: 25 }
  const plotWidth = SVG_WIDTH - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => [
      point.applicantCount ?? 0,
      point.acceptedCount ?? 0,
      point.capacity ?? 0,
    ]),
  )
  const slot = plotWidth / points.length
  const barWidth = Math.min(24, slot * 0.55)
  const labelInterval = Math.max(1, Math.ceil(points.length / 8))
  const y = (value: number) => padding.top + (1 - value / maxValue) * plotHeight
  const baseY = padding.top + plotHeight

  return (
    <svg
      viewBox={`0 0 ${SVG_WIDTH} ${height}`}
      role="img"
      aria-label={`${grade}級の申込者数と抽選・定員の推移`}
      className="w-full"
      style={{ height: 'auto' }}
    >
      <line x1={padding.left} y1={baseY} x2={SVG_WIDTH - padding.right} y2={baseY} className="stroke-border" />
      {points.map((point, index) => {
        const center = padding.left + slot * index + slot / 2
        const applicants = point.applicantCount ?? 0
        const applicantY = y(applicants)
        return (
          <g key={`${point.editionNumber}-${point.year ?? 'unknown'}`}>
            <rect
              x={center - barWidth / 2}
              y={applicantY}
              width={barWidth}
              height={baseY - applicantY}
              rx={2}
              className="fill-brand opacity-30"
            />
            {point.selectionStatus === 'lottery' && point.acceptedCount != null ? (
              <circle cx={center} cy={y(point.acceptedCount)} r={3} className="fill-brand" />
            ) : null}
            {point.selectionStatus === 'under_capacity' && point.capacity != null ? (
              <line
                x1={center - barWidth / 2 - 2}
                y1={y(point.capacity)}
                x2={center + barWidth / 2 + 2}
                y2={y(point.capacity)}
                className="stroke-ink-muted"
                strokeWidth={1.5}
              />
            ) : null}
            {index % labelInterval === 0 || index === points.length - 1 ? (
              <text x={center} y={height - 8} textAnchor="middle" className="fill-ink-muted" fontSize={8}>
                第{point.editionNumber}回
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function AGradeCutoffChart({
  cutoff,
  capacityLine,
}: {
  cutoff: AGradeCutoffAggregate
  capacityLine: AGradeCutoffAggregate['capacityLine']
}) {
  const segments = [
    ...(cutoff.organizerSlots.applicantCount > 0
      ? [{ key: 'organizer', label: '主催者枠', count: cutoff.organizerSlots.applicantCount }]
      : []),
    ...cutoff.appearanceBuckets
      .filter((bucket) => bucket.applicantCount > 0)
      .map((bucket) => ({
        key: `appearance-${bucket.appearanceCount}`,
        label: `${bucket.appearanceCount}回`,
        count: bucket.applicantCount,
      })),
  ]
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  const scaleMax = Math.max(total, capacityLine?.capacity ?? 0, 1)
  const plotLeft = 8
  const plotWidth = SVG_WIDTH - 16
  let cumulative = 0

  return (
    <svg
      viewBox={`0 0 ${SVG_WIDTH} 64`}
      role="img"
      aria-label={`A級の年度内出場回数別申込者。合計${total}人${capacityLine ? `、定員${capacityLine.capacity}人` : ''}`}
      className="mt-2 w-full"
      style={{ height: 'auto' }}
    >
      {segments.map((segment, index) => {
        const x = plotLeft + (cumulative / scaleMax) * plotWidth
        const width = (segment.count / scaleMax) * plotWidth
        cumulative += segment.count
        return (
          <rect
            key={segment.key}
            data-a-grade-segment={segment.key}
            aria-label={`${segment.label} ${segment.count}人`}
            x={x}
            y={12}
            width={width}
            height={24}
            className={segment.key === 'organizer' ? 'fill-ink-muted' : 'fill-brand'}
            opacity={segment.key === 'organizer' ? 0.75 : Math.min(1, 0.42 + index * 0.14)}
          />
        )
      })}
      {capacityLine ? (
        <g>
          <line
            data-testid="a-grade-capacity-line"
            x1={plotLeft + (capacityLine.capacity / scaleMax) * plotWidth}
            y1={6}
            x2={plotLeft + (capacityLine.capacity / scaleMax) * plotWidth}
            y2={43}
            className="stroke-ink"
            strokeWidth={2}
          />
          <text
            x={plotLeft + (capacityLine.capacity / scaleMax) * plotWidth}
            y={54}
            textAnchor="middle"
            className="fill-ink-meta"
            fontSize={8}
          >
            定員 {capacityLine.capacity}
          </text>
        </g>
      ) : null}
    </svg>
  )
}
