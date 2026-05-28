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
 * Mobile-first application shell. Fits the visible viewport via `h-dvh`
 * (with `h-screen` fallback for older browsers) so AppBar and BottomNav
 * stay pinned at the flex edges and only `<main>` scrolls — keeping the
 * 44px top bar and 52px bottom tab bar visible regardless of page length
 * or iOS Safari URL-bar collapse. Matches the `MobileFrame` prototype in
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
  // Height stack (cascade order matters — last valid utility wins):
  //   h-screen → 100vh   (very old browsers; legacy fallback)
  //   h-dvh    → 100dvh  (mid; reflects current visualViewport)
  //   h-svh    → 100svh  (final; the SMALL viewport, i.e. the height
  //                       assuming all UA chrome is shown — bottom URL
  //                       bar included)
  // We end on `h-svh` because iOS Safari (15.4+) with `viewport-fit=cover`
  // returns a `100dvh` value that *includes* the bottom URL bar overlay,
  // so the shell can be taller than the visible safe area and push
  // BottomNav under the URL bar (observed on PR #67 production). `100svh`
  // is the conservative "always visible" height that guarantees the
  // BottomNav stays above the URL bar at the cost of an extra empty band
  // when the URL bar later collapses on scroll.
  return (
    <div className="flex h-screen h-dvh h-svh flex-col bg-canvas text-ink font-sans">
      <AppBarMain user={user} signOutAction={signOutAction} />
      {/*
        `min-h-0` is required: flex items default to `min-height: auto`,
        which prevents <main> from shrinking below its content height even
        with `overflow-y-auto`. Without it the inner content pushes <main>
        past the shell, the shell bleeds past h-dvh, and body scroll
        carries AppBar/BottomNav off-screen — exactly the bug we are trying
        to fix. See https://developer.mozilla.org/en-US/docs/Web/CSS/min-height#values
      */}
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      <BottomNav isAdmin={isAdmin} />
    </div>
  )
}
