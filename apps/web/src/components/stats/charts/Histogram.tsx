import { axisTicks, formatCompact, formatDecimal1, niceMax } from './chart-utils'

export interface HistogramProps {
  /** 枚数差ヒスト（length 25：index i＝枚数差 i+1 の試合数）。 */
  bins: number[]
  /** 平均枚数差（破線マーカー）。 */
  average: number
  /** 棒色（既定 藍）。 */
  color?: string
  height?: number
  ariaLabel: string
  className?: string
  /** 平均ラベル「平均 N.N」を線の上に出す（既定 true）。 */
  showAverageLabel?: boolean
}

const VW = 320
const PL = 32
const PR = 6
const PT = 14
const PB = 20
/** x 軸ラベルを出す枚数差（1・5・10・15・20・25）。 */
const X_TICKS = [1, 5, 10, 15, 20, 25]

/**
 * 枚数差ヒストグラム（25 本）＋平均線。design-spec §3.2 / §3.3。
 * 平均マーカーは **中立インクの破線**（朱不使用・design-spec §8 / R2）、平均の数値ラベルは藍。
 * 純粋 SVG（フックなし）。棒が密（25 本）なので値ラベルは出さず y 目盛で桁を読む。
 */
export function Histogram({
  bins,
  average,
  color = 'var(--color-brand)',
  height = 150,
  ariaLabel,
  className,
  showAverageLabel = true,
}: HistogramProps) {
  const plotW = VW - PL - PR
  const plotH = height - PT - PB
  const maxVal = bins.reduce((m, v) => Math.max(m, v), 0)
  const top = niceMax(maxVal)
  const ticks = axisTicks(maxVal)

  const yOf = (v: number) => PT + (1 - v / top) * plotH
  const baseY = yOf(0)
  const n = bins.length // 25
  const slot = plotW / n
  const barW = slot * 0.72

  // 枚数差 d(=1..25) の棒中心 x。連続平均も同じ写像で位置付ける。
  const cxOfDiff = (d: number) => PL + slot * (d - 1) + slot / 2
  const avgClamped = Math.min(Math.max(average, 1), n)
  const avgX = cxOfDiff(avgClamped)

  return (
    <svg
      viewBox={`0 0 ${VW} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ width: '100%', height: 'auto' }}
    >
      {ticks.map((t, i) => {
        const y = yOf(t)
        return (
          <g key={`t${i}`}>
            <line
              x1={PL}
              y1={y}
              x2={VW - PR}
              y2={y}
              className="stroke-border"
              strokeWidth={0.5}
            />
            <text
              x={PL - 3}
              y={y + 3}
              textAnchor="end"
              className="fill-ink-muted"
              fontSize={8}
            >
              {formatCompact(t)}
            </text>
          </g>
        )
      })}

      {bins.map((v, i) => {
        const x = PL + slot * i + (slot - barW) / 2
        const y = yOf(v)
        return (
          <rect
            key={`h${i}`}
            x={x}
            y={y}
            width={barW}
            height={Math.max(0, baseY - y)}
            fill={color}
          />
        )
      })}

      {/* x 軸ラベル（1・5・…・25） */}
      {X_TICKS.map((d) => (
        <text
          key={`x${d}`}
          x={cxOfDiff(d)}
          y={height - 6}
          textAnchor="middle"
          className="fill-ink-muted"
          fontSize={8}
        >
          {d}
        </text>
      ))}

      {/* 平均線＝中立インク破線（朱不使用）＋藍の数値ラベル */}
      {average > 0 ? (
        <>
          <line
            x1={avgX}
            y1={PT - 2}
            x2={avgX}
            y2={baseY}
            className="stroke-neutral-fg"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          {showAverageLabel ? (
            <text
              x={Math.min(avgX + 3, VW - PR)}
              y={PT + 6}
              textAnchor={avgX > VW - 60 ? 'end' : 'start'}
              className="fill-brand font-display"
              fontSize={8.5}
            >
              {`平均 ${formatDecimal1(average)}`}
            </text>
          ) : null}
        </>
      ) : null}
    </svg>
  )
}
