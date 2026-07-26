import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SectionRuleAuxTone = 'meta' | 'warn'

export interface SectionRuleProps {
  /** 見出し文字列（Serif 18px semibold）。 */
  title: ReactNode
  /** 見出し直後の大きな数値（藍 20px bold tabular-nums）。 */
  count?: ReactNode
  /** count の直後の単位（sans 12px。例 '名'）。count 指定時のみ意味を持つ。 */
  countUnit?: ReactNode
  /** 見出し内の小さな注記（sans 12px。例 '（抽選日：8/7）'）。 */
  sub?: ReactNode
  /** 右端の補助スロット。未指定なら描かない。 */
  aux?: ReactNode
  /** aux の色。既定 'meta'。'warn' で朱（accent-fg）。 */
  auxTone?: SectionRuleAuxTone
  className?: string
  children?: ReactNode
}

/**
 * 罫線セクション見出し（脱カードの基盤）。下線 1 本＋余白のみで区切り、
 * 背景・枠線などの「箱」は一切足さない（design-spec の脱カード方針）。
 */
export function SectionRule({
  title,
  count,
  countUnit,
  sub,
  aux,
  auxTone = 'meta',
  className,
  children,
}: SectionRuleProps) {
  return (
    <section className={cn('pt-[34px]', className)}>
      <div className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-[7px] mb-[13px]">
        <h2 className="font-display text-[18px] font-semibold text-ink">
          {title}
          {count != null && (
            <span className="ml-2 text-[20px] font-bold text-brand tabular-nums">
              {count}
              {countUnit != null && (
                <span className="ml-px font-sans text-xs font-normal text-ink-meta">
                  {countUnit}
                </span>
              )}
            </span>
          )}
          {sub != null && (
            <span className="font-sans text-xs font-normal text-ink-meta tabular-nums">
              {sub}
            </span>
          )}
        </h2>
        {aux != null && (
          <span
            className={cn(
              'text-xs',
              auxTone === 'warn' ? 'text-accent-fg' : 'text-ink-meta',
            )}
          >
            {aux}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}
