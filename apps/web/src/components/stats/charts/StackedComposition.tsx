import { ALL_GRADES } from '@/lib/stats/types'
import { GRADE_TONE_ENTRIES, GRADE_TONES } from '@/lib/stats/grade-tones'
import type { GradeCompositionPoint } from '@/lib/stats/overview'

export interface StackedCompositionProps {
  /** 年昇順の級別構成（各年 A〜E の延べ参加）。 */
  data: GradeCompositionPoint[]
  height?: number
  ariaLabel: string
  className?: string
}

const VW = 320
const PL = 28
const PR = 6
const PT = 8
const PB = 20
const PCT_TICKS = [0, 50, 100]

/**
 * 級別構成の推移（100% 積み上げ棒）。design-spec §3.2 図1。各年を 100% に正規化して
 * A（藍）→E（砂）を下から積む（トーンランプ＝虹色でない）。細い区切り線＝surface ストローク。
 * 図内で級別比較が完成するため詳細ドリルは持たない。純粋 SVG。
 */
export function StackedComposition({
  data,
  height = 160,
  ariaLabel,
  className,
}: StackedCompositionProps) {
  const plotW = VW - PL - PR
  const plotH = height - PT - PB
  const baseY = height - PB
  const n = data.length
  const slot = n > 0 ? plotW / n : plotW
  const barW = Math.min(slot * 0.62, 24)
  const xEvery = n > 12 ? 2 : 1

  return (
    <svg
      viewBox={`0 0 ${VW} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ width: '100%', height: 'auto' }}
    >
      {/* 0/50/100% 目盛 */}
      {PCT_TICKS.map((pct) => {
        const y = baseY - (pct / 100) * plotH
        return (
          <g key={`p${pct}`}>
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
              {pct}
            </text>
          </g>
        )
      })}

      {data.map((point, i) => {
        const total = ALL_GRADES.reduce((s, g) => s + point.counts[g], 0)
        const x = PL + slot * i + (slot - barW) / 2
        const cx = PL + slot * i + slot / 2
        const showX = i % xEvery === 0 || i === n - 1
        let cum = 0
        const segs = total > 0
          ? ALL_GRADES.map((g) => {
              const frac = point.counts[g] / total
              const segBottom = baseY - (cum / total) * plotH
              cum += point.counts[g]
              const segTop = baseY - (cum / total) * plotH
              return { g, y: segTop, h: segBottom - segTop, frac }
            })
          : []
        return (
          <g key={`c${point.year}`}>
            {segs.map((s) =>
              s.h > 0 ? (
                <rect
                  key={s.g}
                  x={x}
                  y={s.y}
                  width={barW}
                  height={s.h}
                  fill={GRADE_TONES[s.g]}
                  className="stroke-surface"
                  strokeWidth={0.4}
                />
              ) : null,
            )}
            {showX ? (
              <text
                x={cx}
                y={height - 6}
                textAnchor="middle"
                className="fill-ink-muted"
                fontSize={8}
              >
                {point.year}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/** A〜E のトーン凡例（級別構成の下などに置く）。 */
export function GradeLegend({ className }: { className?: string }) {
  return (
    <ul className={className ?? 'flex flex-wrap gap-x-3 gap-y-1'}>
      {GRADE_TONE_ENTRIES.map(([g, tone]) => (
        <li key={g} className="flex items-center gap-1 text-[11px] text-ink-meta">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: tone }}
          />
          {g}級
        </li>
      ))}
    </ul>
  )
}
