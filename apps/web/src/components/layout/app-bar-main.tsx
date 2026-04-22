export interface AppBarMainProps {
  /**
   * Trailing identifier text — typically `'{name}さん'`. The caller is
   * responsible for formatting (empty string is acceptable when the
   * session has no display name).
   */
  user: string
  /**
   * Server Action executed when the user taps the logout link. Passed
   * through from `(app)/layout.tsx` via `MobileShell`.
   */
  signOutAction: () => Promise<void>
}

/**
 * Sticky mobile top bar (44px tall). Renders the wordmark on the left and
 * `{name}さん` + logout on the right, matching the prototype `MobileFrame`
 * top bar in `docs/design/ui_kits/kagetra-mobile/primitives.jsx`.
 *
 * Server component on purpose — consumes a Server Action via `<form>`.
 */
export function AppBarMain({ user, signOutAction }: AppBarMainProps) {
  return (
    <div className="h-11 flex-shrink-0 flex items-center justify-between bg-surface border-b border-border px-4">
      <div className="font-serif font-bold text-base text-brand tracking-[0.02em]">
        かげとら
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-ink-meta">{user}</span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-xs text-ink-meta hover:text-brand transition-colors"
          >
            ログアウト
          </button>
        </form>
      </div>
    </div>
  )
}
