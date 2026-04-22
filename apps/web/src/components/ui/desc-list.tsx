import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DescListItem {
  label: string
  value: ReactNode
}

export interface DescListProps {
  items: DescListItem[]
  className?: string
}

/**
 * `<dt>` / `<dd>`-style key/value rows for detail panes. Rows above the first
 * get a hairline top border to visually separate entries without heavy
 * dividers.
 *
 * Accepts `{ label, value }` objects (the prototype used tuple arrays which
 * were harder to read at call sites).
 */
export function DescList({ items, className }: DescListProps) {
  return (
    <div className={className}>
      {items.map((item, i) => (
        <div
          key={`${item.label}-${i}`}
          className={cn(
            'flex items-start py-2.5 text-[13px]',
            i > 0 && 'border-t border-border-soft',
          )}
        >
          <div className="w-24 flex-shrink-0 text-ink-meta text-xs pt-px">
            {item.label}
          </div>
          <div className="flex-1 text-ink">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
