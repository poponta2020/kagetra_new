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
 * Sticky mobile bottom tab bar (52px tall). Tabs per `docs/design/design.md`
 * §3 — ホーム / イベント / 予定 / 会員 (admin only until a member-facing list
 * exists).
 *
 * Client component because it reads the current pathname via
 * `usePathname()` to highlight the active tab.
 */
export function BottomNav({ isAdmin }: BottomNavProps) {
  const pathname = usePathname() ?? ''
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin)
  return (
    <nav className="h-[52px] flex-shrink-0 flex items-stretch bg-surface border-t border-border">
      {visibleTabs.map((tab) => {
        const active = tab.matches.some((prefix) =>
          matchesPath(pathname, prefix),
        )
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              'flex-1 flex items-center justify-center text-[11px] font-medium border-t-2 transition-colors',
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
