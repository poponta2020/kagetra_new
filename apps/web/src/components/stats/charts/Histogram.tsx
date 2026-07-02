import { formatDecimal1, formatPercentTick } from './chart-utils'

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
const PR = 26
const PT = 14
const PB = 20
/** x 軸ラベルを出す枚数差（1・5・10・15・20・25）。 */
const X_TICKS = [1, 5, 10, 15, 20, 25]
/** 左軸（試合割合%）の上端。全図共通の固定スケール（級間で高さを直接比較できるように）。 */
const Y_MAX = 10
/** 左軸の目盛（0/2.5/5/7.5/10%）。右軸 0/25/50/75/100 と同じ4等分＝罫線を共有する。 */
const Y_TICKS = [0, 2.5, 5, 7.5, 10]
/** 右軸（累積%）の目盛。累積は必ず 0〜100% なので固定刻み。 */
const CUM_TICKS = [0, 25, 50, 75, 100]

/**
 * 枚数差パレート図（棒 25 本＋累積%折れ線＋平均線）。design-spec §3.2 / §3.3。
 * 左軸＝枚数差ごとの試合割合(%・全図共通 0〜10% 固定)、右軸＝累積割合(0〜100%固定)。
 * 10% を超えるビン（期間を狭く絞った小母数の級で起こり得る）は上端で頭打ちに描く。
 * 累積線は中立インクの実線、平均マーカーは **中立インクの破線**（いずれも朱不使用・
 * design-spec §8 / R2）、平均の数値ラベルは藍。純粋 SVG（フックなし）。棒が密（25 本）
 * なので値ラベルは出さず y 目盛（割合 %）で読む。
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
  // 縦軸は「全試合に対する割合(%)」。各図（メイン＝全級／詳細＝各級）ごとに自分の合計を
  // 分母に正規化するので、絶対数(数千〜万)ではなく枚数差分布の形として読める。
  // スケールは全図共通の 0〜Y_MAX(10%) 固定（全期間表示の最大ビンは 9.7% 弱で収まる実測）。
  const total = bins.reduce((s, v) => s + v, 0)
  const pct = bins.map((v) => (total > 0 ? (v / total) * 100 : 0))
  const top = Y_MAX
  const ticks = Y_TICKS

  const yOf = (v: number) => PT + (1 - Math.min(v, top) / top) * plotH
  const baseY = yOf(0)
  const n = bins.length // 25
  const slot = plotW / n
  const barW = slot * 0.72

  // 枚数差 d(=1..25) の棒中心 x。連続平均も同じ写像で位置付ける。
  const cxOfDiff = (d: number) => PL + slot * (d - 1) + slot / 2
  const avgClamped = Math.min(Math.max(average, 1), n)
  const avgX = cxOfDiff(avgClamped)

  // パレート用の累積割合(%)。左軸（個別正規化）とはスケールが異なるため右軸（0〜100%固定）
  // で写像する。合計 0 のときは折れ線を描かない（0 除算による NaN 座標を避ける）。
  const cum: number[] = []
  pct.reduce((acc, v) => {
    const next = acc + v
    cum.push(next)
    return next
  }, 0)
  const yOfCum = (v: number) => PT + (1 - v / 100) * plotH
  const cumPoints = cum.map((v, i) => `${cxOfDiff(i + 1)},${yOfCum(v)}`).join(' ')

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
              {formatPercentTick(t)}
            </text>
          </g>
        )
      })}

      {/* 右軸（累積%）の目盛ラベル */}
      {CUM_TICKS.map((t) => (
        <text
          key={`c${t}`}
          x={VW - PR + 3}
          y={yOfCum(t) + 3}
          textAnchor="start"
          className="fill-ink-muted"
          fontSize={8}
        >
          {formatPercentTick(t)}
        </text>
      ))}

      {pct.map((v, i) => {
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

      {/* 累積%の折れ線（パレート・右軸スケール・中立インク実線＝破線の平均線と区別） */}
      {total > 0 ? (
        <polyline points={cumPoints} fill="none" className="stroke-neutral-fg" strokeWidth={1.2} />
      ) : null}

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
