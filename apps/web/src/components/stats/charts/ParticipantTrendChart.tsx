import type { ParticipantTrendPoint } from '@/lib/stats/series'
import { axisTicks, formatCompact, niceMax } from './chart-utils'

/**
 * シリーズ詳細の「参加者数の推移」（design-spec §3.6.3）。全級合計・記録のある年の棒＋
 * **中止年は朱の破線**で欠落を明示する。純 SVG（フックなし＝サーバー描画・jsdom テスト可）。
 * 棒＝藍（正の強調）、中止マーカーだけ朱（design-spec §8：朱は中止/締切等のみ・データ装飾に使わない）。
 */

const VW = 320
const PL = 32
const PR = 6
const PT = 14
const PB = 22

export function ParticipantTrendChart({
  points,
  height = 160,
  ariaLabel = '参加者数の推移',
  className,
}: {
  points: ParticipantTrendPoint[]
  height?: number
  ariaLabel?: string
  className?: string
}) {
  const plotW = VW - PL - PR
  const plotH = height - PT - PB
  const maxVal = points.reduce((m, p) => Math.max(m, p.count), 0)
  const top = niceMax(maxVal)
  const ticks = axisTicks(maxVal)

  const yOf = (v: number) => PT + (1 - v / top) * plotH
  const baseY = yOf(0)

  const n = points.length
  const slot = n > 0 ? plotW / n : plotW
  const barW = Math.min(slot * 0.62, 22)
  const showValueLabels = slot >= 16
  const xEvery = n > 12 ? 2 : 1

  return (
    <svg
      viewBox={`0 0 ${VW} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ width: '100%', height: 'auto' }}
    >
      {/* y 目盛線＋ラベル */}
      {ticks.map((t, i) => {
        const y = yOf(t)
        return (
          <g key={`t${i}`}>
            <line x1={PL} y1={y} x2={VW - PR} y2={y} className="stroke-border" strokeWidth={0.5} />
            <text x={PL - 3} y={y + 3} textAnchor="end" className="fill-ink-muted" fontSize={8}>
              {formatCompact(t)}
            </text>
          </g>
        )
      })}

      {points.map((p, i) => {
        const cx = PL + slot * i + slot / 2
        const showX = i % xEvery === 0 || i === n - 1
        const yLabel = (
          showX ? (
            <text
              x={cx}
              y={height - 7}
              textAnchor="middle"
              className={p.cancelled ? 'fill-accent-fg' : 'fill-ink-muted'}
              fontSize={8}
            >
              {p.year}
            </text>
          ) : null
        )
        if (p.cancelled) {
          // 中止年＝朱の破線（欠落明示）。棒は描かない。
          return (
            <g key={`c${i}`}>
              <line
                x1={cx}
                y1={PT}
                x2={cx}
                y2={baseY}
                className="stroke-accent"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              {yLabel}
            </g>
          )
        }
        const x = PL + slot * i + (slot - barW) / 2
        const y = yOf(p.count)
        const h = Math.max(0, baseY - y)
        return (
          <g key={`b${i}`}>
            <rect x={x} y={y} width={barW} height={h} rx={1} className="fill-brand" />
            {showValueLabels && p.count > 0 ? (
              <text x={cx} y={y - 2} textAnchor="middle" className="fill-ink-meta font-display" fontSize={7.5}>
                {formatCompact(p.count)}
              </text>
            ) : null}
            {yLabel}
          </g>
        )
      })}
    </svg>
  )
}
