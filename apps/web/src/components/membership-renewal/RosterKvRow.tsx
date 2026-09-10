import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * `RosterKvRow`（design-spec §4）— 名簿 1 項目の行（S1・S2 共通の見た目）。
 *
 * ラベル列は固定幅 72px（design-spec §7・§8）。中身（値表示／編集入力／
 * 未入力＋errmsg／差分の前後／読み取り専用）は呼び出し側が `children` に組んで
 * 渡す —— このコンポーネント自体は行のシェル（ラベル・必須マーク・右端の
 * アクションスロット）だけを持つ。
 */
export interface RosterKvRowProps {
  label: ReactNode
  /** 必須項目マーク（`*`・朱）を出す。 */
  required?: boolean
  /** 右端のアクション（「修正」リンク等）。表示モードでのみ渡す。 */
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function RosterKvRow({
  label,
  required = false,
  action,
  className,
  children,
}: RosterKvRowProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 border-t border-border-soft py-2 first:border-t-0',
        className,
      )}
    >
      <span className="w-[72px] flex-none pt-[3px] text-xs text-ink-meta">
        {label}
        {required && <span className="text-accent-fg">*</span>}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {action != null && <div className="flex-none pt-[1px]">{action}</div>}
    </div>
  )
}
