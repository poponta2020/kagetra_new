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
  // senseki-stats (PR-2): 戦績 → 統計 に改称。href は /players 据え置き
  // （着地点＝選手検索）だが、配下の 4 セクション（選手検索/大会結果/ランキング/
  // 大会統計）は /players・/tournaments の 2 基底に分かれるため両方を active 判定。
  {
    id: 'players',
    label: '統計',
    href: '/players',
    matches: ['/players', '/tournaments'],
  },
  // entry-management: 管理者向け大会申込進捗ボード。管理者専用ブロックの先頭に
  // 置き、共通 3 タブ（ホーム/イベント/統計）の直後から管理業務が始まる並びにする。
  {
    id: 'entries',
    label: '申込管理',
    href: '/admin/entries',
    matches: ['/admin/entries'],
    adminOnly: true,
  },
  // mail-tournament-import (PR1): admin-only inbox of mails fetched by
  // apps/mail-worker. 未処理バッジを持つ日常動線なのでナビに残す。
  {
    id: 'mail-inbox',
    label: 'メール',
    href: '/admin/mail-inbox',
    matches: ['/admin/mail-inbox'],
    adminOnly: true,
  },
  // nav-settings-hub: 上部バー（ワードマーク＋`{name}さん` タップの設定シート）
  // 廃止に伴う設定の受け皿。会員 (`/admin/members`) と Bot
  // (`/admin/line-channels`) は独立タブをやめて設定ハブ経由の導線にしたため、
  // その配下にいる間もこのタブを active にして「設定から辿った先」だと分かる
  // ようにする。常に最後尾。
  {
    id: 'settings',
    label: '設定',
    href: '/settings',
    matches: ['/settings', '/admin/members', '/admin/line-channels'],
  },
]

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export interface BottomNavProps {
  /**
   * Whether the current user is admin/vice_admin. Controls visibility of
   * admin-only tabs (申込管理 / メール).
   */
  isAdmin: boolean
  /**
   * role-preview-switch: プレビュー中の表示ロール名（例 `'一般会員'`）。
   * 非プレビュー時は null。上部バー廃止でバッジの居場所が無くなったため、
   * 切替を行う場所と同じ「設定」タブの上に出す。
   */
  previewRoleLabel?: string | null
}

/**
 * Sticky mobile bottom tab bar. Tabs are 52px tall; the `<nav>` itself
 * reserves `52px + env(safe-area-inset-bottom)` so the bg-surface fill
 * extends into the iOS home-indicator area without compressing the tap
 * targets. Tabs: ホーム / イベント / 統計 / 設定 を全員に、申込管理 / メール を
 * 管理者に追加（一般会員 4 タブ・管理者 6 タブ）。
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
export function BottomNav({
  isAdmin,
  previewRoleLabel = null,
}: BottomNavProps) {
  const pathname = usePathname() ?? ''
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin)
  return (
    <nav className="min-h-[calc(52px_+_env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] flex-shrink-0 flex items-stretch bg-surface border-t border-border">
      {visibleTabs.map((tab) => {
        const active = tab.matches.some((prefix) =>
          matchesPath(pathname, prefix),
        )
        const showPreviewBadge = tab.id === 'settings' && !!previewRoleLabel
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-label={
              showPreviewBadge
                ? `${tab.label}（${previewRoleLabel}として表示中）`
                : undefined
            }
            className={cn(
              'h-[52px] flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium border-t-2 transition-colors',
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-meta',
            )}
          >
            {showPreviewBadge ? (
              <span className="inline-flex max-w-full items-center rounded-full bg-brand-bg px-1.5 py-px text-[9px] font-medium leading-tight text-brand-fg whitespace-nowrap">
                {previewRoleLabel}
              </span>
            ) : null}
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
