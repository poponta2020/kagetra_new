import type { ReactNode } from 'react'

export interface SectionLabelProps {
  children: ReactNode
  /** Optional trailing action (e.g. "すべて見る") rendered in brand colour. */
  action?: ReactNode
}

/**
 * Small uppercase-ish heading used above cards/lists. Left side is the
 * section title; right side is an optional action link.
 */
export function SectionLabel({ children, action }: SectionLabelProps) {
  return (
    <div className="flex items-baseline justify-between px-1 mb-2">
      <div className="text-xs font-semibold text-ink-meta tracking-[0.02em]">
        {children}
      </div>
      {action && (
        <div className="text-xs text-brand font-medium">{action}</div>
      )}
    </div>
  )
}
