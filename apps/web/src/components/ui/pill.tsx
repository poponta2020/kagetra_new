import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type PillTone =
  | 'brand'
  | 'success'
  | 'danger'
  | 'info'
  | 'warn'
  | 'neutral'

export type PillSize = 'sm' | 'md'

export interface PillProps {
  tone?: PillTone
  size?: PillSize
  children: ReactNode
  className?: string
}

const TONE_CLASS: Record<PillTone, string> = {
  brand: 'bg-brand-bg text-brand-fg',
  success: 'bg-success-bg text-success-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  warn: 'bg-warn-bg text-warn-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
}

const SIZE_CLASS: Record<PillSize, string> = {
  sm: 'text-[10px] px-1.5 py-px',
  md: 'text-[11px] px-2 py-0.5',
}

/**
 * Rounded badge used for statuses, grades, and short metadata labels.
 *
 * Six semantic tones + two sizes. Background/foreground come from the
 * Tailwind v4 `@theme` tokens declared in `app/globals.css`.
 */
export function Pill({
  tone = 'neutral',
  size = 'md',
  children,
  className,
}: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
