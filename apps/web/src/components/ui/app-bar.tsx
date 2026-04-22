import type { ReactNode } from 'react'

export interface AppBarProps {
  title: string
  /**
   * Optional back handler. When provided, a `‹` chevron button is rendered
   * to the left of the title.
   */
  onBack?: () => void
  /** Optional trailing action (button, pill, etc.). */
  action?: ReactNode
}

/**
 * In-screen header (distinct from `MobileShell`'s outer top bar).
 *
 * Used for detail screens that want a title + back affordance without
 * replacing the shell chrome.
 */
export function AppBar({ title, onBack, action }: AppBarProps) {
  return (
    <div className="h-11 flex items-center justify-between px-3 bg-surface border-b border-border flex-shrink-0">
      <div className="flex items-center gap-1 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="戻る"
            className="w-8 h-8 flex items-center justify-center text-ink-2 text-xl"
          >
            ‹
          </button>
        )}
        <div className="text-[15px] font-semibold text-ink truncate">
          {title}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
