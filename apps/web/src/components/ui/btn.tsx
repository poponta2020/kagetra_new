import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger'
export type BtnSize = 'sm' | 'md' | 'lg'

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: BtnKind
  size?: BtnSize
  /** Makes the button fill its container width. */
  block?: boolean
}

const KIND_CLASS: Record<BtnKind, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary:
    'bg-surface text-ink-2 border border-border hover:bg-surface-alt',
  ghost: 'bg-transparent text-brand hover:bg-brand-bg',
  danger: 'bg-danger-bg text-danger-fg hover:opacity-90',
}

const SIZE_CLASS: Record<BtnSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
}

/**
 * Primary action button. Extends `<button>` so `onClick`, `disabled`,
 * `type`, `aria-*` etc. all pass through. Keep Btn itself server-renderable
 * by leaving `onClick` wiring to client-component parents.
 */
export function Btn({
  kind = 'primary',
  size = 'md',
  block = false,
  className,
  children,
  type = 'button',
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        KIND_CLASS[kind],
        SIZE_CLASS[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
