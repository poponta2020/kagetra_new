import type { ReactNode } from 'react'
import { AppBarMain } from './app-bar-main'
import { BottomNav } from './bottom-nav'

export interface MobileShellProps {
  /**
   * Display label for the authenticated user, already formatted by the
   * caller (e.g. `'山田さん'`). Pass an empty string when unavailable.
   */
  user: string
  /**
   * Whether the signed-in user has admin/vice_admin privileges. Forwarded
   * to `BottomNav` to gate admin-only tabs.
   */
  isAdmin: boolean
  /** Server Action forwarded to the top bar's logout form. */
  signOutAction: () => Promise<void>
  children: ReactNode
}

/**
 * Mobile-first application shell: sticky 44px top bar + scrollable main +
 * sticky 52px bottom tab bar. Matches the `MobileFrame` prototype in
 * `docs/design/ui_kits/kagetra-mobile/primitives.jsx` and §3 of
 * `docs/design/design.md`.
 *
 * Intentionally NO responsive (`md:` / `lg:`) modifiers and NO `max-w-*`
 * constraints — the design is mobile-only by specification. Admin tables
 * that need a wider layout scope their own `max-w-5xl` per-page.
 *
 * Server component; client-only bits (pathname-aware tab highlighting)
 * live inside `BottomNav`.
 */
export function MobileShell({
  user,
  isAdmin,
  signOutAction,
  children,
}: MobileShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink font-sans">
      <AppBarMain user={user} signOutAction={signOutAction} />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <BottomNav isAdmin={isAdmin} />
    </div>
  )
}
