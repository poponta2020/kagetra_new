import { axisTicks, formatCompact, niceMax, type LabeledValue } from './chart-utils'

export interface BarDatum extends LabeledValue {
  /** 棒ごとの色（級別トーン等）。無指定なら chart の color。 */
  color?: string
}

export interface BarChartProps {
  data: BarDatum[]
  /** 既定の棒色（design-spec §8：正の強調＝藍。朱はデータ装飾に使わない）。 */
  color?: string
  /** viewBox 高さ（既定 160）。幅は 320 固定で親幅にスケール。 */
  height?: number
  /** スクリーンリーダー用の説明（必須）。 */
  ariaLabel: string
  /** y 軸目盛ラベルの整形（既定 formatCompact）。 */
  valueFormat?: (n: number) => string
  className?: string
}

const VW = 320
const PL = 32 // y 目盛ラベル幅
const PR = 6
const PT = 14 // 上端余白
const PB = 22 // x ラベル余白

/**
 * 縦棒グラフ（y 軸目盛線＋目盛ラベル）。design-spec §3.2。純粋な SVG コンポーネント
 * （フックなし＝サーバー描画・jsdom テスト可）。棒色は既定で藍（朱はデータ装飾に使わない）。
 * 棒上の値ラベルは出さず y 目盛で値を読む（オーナー指示・小さなモバイル図の煩雑さ回避）。
 * x が密なとき（>12 本）は x ラベルを間引く。y 目盛は件数軸（全値が整数）なら整数刻み。
 */
export function BarChart({
  data,
  color = 'var(--color-brand)',
  height = 160,
  ariaLabel,
  valueFormat = formatCompact,
  className,
}: BarChartProps) {
  const plotW = VW - PL - PR
  const plotH = height - PT - PB
  const maxVal = data.reduce((m, d) => Math.max(m, d.value), 0)
  // 全データが整数なら件数軸として整数目盛（0.5 等の小数・重複ラベルを避ける）。
  const integerAxis = data.every((d) => Number.isInteger(d.value))
  const top = niceMax(maxVal, integerAxis)
  const ticks = axisTicks(maxVal, integerAxis)

  const yOf = (v: number) => PT + (1 - v / top) * plotH
  const baseY = yOf(0)

  const n = data.length
  const slot = n > 0 ? plotW / n : plotW
  const barW = Math.min(slot * 0.62, 22)
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
              {valueFormat(t)}
            </text>
          </g>
        )
      })}

      {/* 棒＋x ラベル（棒上の値ラベルは出さない） */}
      {data.map((d, i) => {
        const x = PL + slot * i + (slot - barW) / 2
        const y = yOf(d.value)
        const h = Math.max(0, baseY - y)
        const cx = PL + slot * i + slot / 2
        const showX = i % xEvery === 0 || i === n - 1
        return (
          <g key={`b${i}`}>
            <rect x={x} y={y} width={barW} height={h} rx={1} fill={d.color ?? color} />
            {showX ? (
              <text
                x={cx}
                y={height - 7}
                textAnchor="middle"
                className="fill-ink-muted"
                fontSize={8}
              >
                {d.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
