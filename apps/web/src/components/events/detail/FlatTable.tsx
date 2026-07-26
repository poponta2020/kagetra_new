import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type FlatTableVariant = 'date' | 'num' | 'prewrap'

export interface FlatTableRow {
  /** th の中身。列幅 104px 固定・12px ink-meta・nowrap。 */
  label: ReactNode
  /** td の中身。 */
  value: ReactNode
  /** 'date' → tabular-nums / 'num' → 右寄せ + Serif + tabular-nums / 'prewrap' → 改行保持。 */
  variant?: FlatTableVariant
  /** td へ追加するクラス（級別配信の「未送信」= ink-meta / 「未紐付け」= accent-fg 用）。 */
  valueClassName?: string
  /** key に使う。未指定なら index。 */
  key?: string
}

export interface FlatTableProps {
  rows: readonly FlatTableRow[]
  className?: string
}

const VARIANT_CLASS: Record<FlatTableVariant, string> = {
  date: 'tabular-nums',
  num: 'text-right font-display tabular-nums',
  prewrap: 'whitespace-pre-wrap',
}

/**
 * フラット表（旧 DescList の脱カード版）。行間ヘアラインのみ・tabular-nums・
 * ラベル列固定幅。rows が空なら null を返し、呼び出し側の条件分岐を減らす。
 */
export function FlatTable({ rows, className }: FlatTableProps) {
  if (rows.length === 0) return null

  return (
    <table className={cn('w-full border-collapse text-[13px]', className)}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.key ?? i}>
            <th
              className={cn(
                'w-[104px] whitespace-nowrap py-[7px] text-left align-baseline text-xs font-normal text-ink-meta',
                i > 0 && 'border-t border-border-soft',
              )}
            >
              {row.label}
            </th>
            <td
              className={cn(
                'py-[7px] text-left align-baseline font-normal text-ink',
                i > 0 && 'border-t border-border-soft',
                row.variant && VARIANT_CLASS[row.variant],
                row.valueClassName,
              )}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
