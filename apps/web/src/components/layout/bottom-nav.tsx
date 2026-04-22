'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Tab {
  id: string
  label: string
  href: string
  /**
   * Path prefixes that should mark this tab active. Uses `startsWith` so
   * detail routes (e.g. `/events/123`) also light up the parent tab.
   */
  matches: readonly string[]
}

const TABS: readonly Tab[] = [
  { id: 'home', label: 'ホーム', href: '/dashboard', matches: ['/dashboard'] },
  { id: 'events', label: 'イベント', href: '/events', matches: ['/events'] },
  { id: 'schedule', label: '予定', href: '/schedule', matches: ['/schedule'] },
  {
    id: 'members',
    label: '会員',
    href: '/admin/members',
    // `/members` is not implemented yet; the admin-only list is used as
    // the fallback. Non-admins will be bounced by the per-page 403 guard.
    matches: ['/admin/members', '/members'],
  },
]

/**
 * Sticky mobile bottom tab bar (52px tall). Four fixed tabs as defined in
 * `docs/design/design.md` §3: ホーム / イベント / 予定 / 会員.
 *
 * Client component because it reads the current pathname via
 * `usePathname()` to highlight the active tab.
 */
export function BottomNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="h-[52px] flex-shrink-0 flex items-stretch bg-surface border-t border-border">
      {TABS.map((tab) => {
        const active = tab.matches.some((prefix) =>
          pathname.startsWith(prefix),
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
