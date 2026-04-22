import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps {
  children: ReactNode
  className?: string
}

/**
 * Base surface container: washi-ivory bg, kinari border, 10 px radius.
 *
 * Padding is fixed at 14 px to match the mobile prototype; callers that need
 * a different inner padding should wrap a custom element rather than
 * re-introducing a `pad` prop (the prototype never varied padding).
 */
export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-[10px] p-[14px]',
        className,
      )}
    >
      {children}
    </div>
  )
}
