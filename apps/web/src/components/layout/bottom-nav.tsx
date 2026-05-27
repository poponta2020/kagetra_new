'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Tab {
  id: string
  label: string
  href: string
  /**
   * Path prefixes that should mark this tab active. Matching is
   * segment-boundary aware (exact match or `${prefix}/...`) so sibling
   * routes like `/events-archive` do not light up the `/events` tab.
   */
  matches: readonly string[]
  /** When true, tab is only rendered for admin/vice_admin users. */
  adminOnly?: boolean
}

const TABS: readonly Tab[] = [
  { id: 'home', label: 'ホーム', href: '/dashboard', matches: ['/dashboard'] },
  { id: 'events', label: 'イベント', href: '/events', matches: ['/events'] },
  { id: 'schedule', label: '予定', href: '/schedule', matches: ['/schedule'] },
  {
    id: 'members',
    label: '会員',
    href: '/admin/members',
    // Admin-only until a non-admin `/members` view exists. Showing this
    // to general members regressed their nav to a 403 loop.
    matches: ['/admin/members', '/members'],
    adminOnly: true,
  },
  // mail-tournament-import (PR1): admin-only inbox of mails fetched by
  // apps/mail-worker. Hidden for general members so the BottomNav stays at
  // 4 tabs for them; admins see 5.
  {
    id: 'mail-inbox',
    label: 'メール',
    href: '/admin/mail-inbox',
    matches: ['/admin/mail-inbox'],
    adminOnly: true,
  },
]

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export interface BottomNavProps {
  /**
   * Whether the current user is admin/vice_admin. Controls visibility of
   * admin-only tabs (currently 会員).
   */
  isAdmin: boolean
}

/**
 * Sticky mobile bottom tab bar. Tabs are 52px tall; the `<nav>` itself
 * reserves `52px + env(safe-area-inset-bottom)` so the bg-surface fill
 * extends into the iOS home-indicator area without compressing the tap
 * targets. Tabs per `docs/design/design.md` §3 — ホーム / イベント /
 * 予定 / 会員 (admin only until a member-facing list exists).
 *
 * IMPORTANT — border-box trap: Tailwind defaults to `box-sizing: border-
 * box`, so `min-h-[52px]` measures the **outer** box (border + padding +
 * content). With `pb-[env(safe-area-inset-bottom)]` (~34px on iPhones
 * with a home indicator) the content area collapses to ~18px and the
 * 52px <Link> children overflow visibly below the viewport. We therefore
 * size the min-height as `52px + env(safe-area-inset-bottom)` so the
 * content area always has its full 52px after the safe-area padding is
 * deducted.
 *
 * Client component because it reads the current pathname via
 * `usePathname()` to highlight the active tab.
 */
export function BottomNav({ isAdmin }: BottomNavProps) {
  const pathname = usePathname() ?? ''
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin)
  return (
    <nav className="min-h-[calc(52px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] flex-shrink-0 flex items-stretch bg-surface border-t border-border">
      {visibleTabs.map((tab) => {
        const active = tab.matches.some((prefix) =>
          matchesPath(pathname, prefix),
        )
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              'h-[52px] flex-1 flex items-center justify-center text-[11px] font-medium border-t-2 transition-colors',
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-meta',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
