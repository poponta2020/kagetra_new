import { AccountMenu } from './account-menu'

export interface AppBarMainProps {
  /**
   * Trailing identifier text — typically `'{name}さん'`. The caller is
   * responsible for formatting (empty string is acceptable when the
   * session has no display name).
   */
  user: string
  /**
   * Whether the signed-in user is admin/vice_admin. Forwarded to
   * `AccountMenu` to gate the admin-only メール通知 settings entry.
   */
  isAdmin: boolean
  /**
   * Logout Server Action. Passed through from `(app)/layout.tsx` via
   * `MobileShell` and consumed inside `AccountMenu`'s settings sheet.
   */
  signOutAction: () => Promise<void>
}

/**
 * Sticky mobile top bar (44px tall). Renders the wordmark on the left and
 * the `{name}さん` account trigger on the right. Tapping the name opens the
 * settings sheet (`AccountMenu`) — the affordance specified in
 * `docs/design/design.md` §3 ("設定は `{name}さん` をタップしてシート").
 * Logout now lives inside that sheet rather than as a separate bar button.
 *
 * Server component on purpose — it forwards the logout Server Action down to
 * the client `AccountMenu` without itself becoming a client boundary.
 */
export function AppBarMain({ user, isAdmin, signOutAction }: AppBarMainProps) {
  return (
    <div className="h-11 flex-shrink-0 flex items-center justify-between bg-surface border-b border-border px-4">
      <div className="font-display font-bold text-base text-brand tracking-[0.02em]">
        かげとら
      </div>
      <AccountMenu user={user} isAdmin={isAdmin} signOutAction={signOutAction} />
    </div>
  )
}
