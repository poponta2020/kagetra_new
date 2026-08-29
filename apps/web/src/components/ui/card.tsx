import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps {
  children: ReactNode
  className?: string
}

/**
 * Base surface container: surface bg, soft border, 10 px radius, elevation 1.
 *
 * `shadow-sm` は高度の段 1（globals.css の Shadows 節を参照）。以前は影が
 * 無く、すべてのカードがページと完全に同じ平面にいて 1px の枠線だけで
 * 区別されていた — これが「背景がのっぺりしている」の実体だった。
 *
 * 枠線が `border-soft` なのは影と併用するため。全強度の `border` と影を
 * 重ねると「枠付きの箱に汚れが付いた」ように見える。輪郭は影が担い、
 * 枠線は境界の補助に退く。
 *
 * Padding is fixed at 14 px to match the mobile prototype; callers that need
 * a different inner padding should wrap a custom element rather than
 * re-introducing a `pad` prop (the prototype never varied padding).
 */
export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border-soft rounded-[10px] p-[14px] shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}
