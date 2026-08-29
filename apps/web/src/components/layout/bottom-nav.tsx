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
  /**
   * member-mail-search: 一般会員向けの遷移先。`isAdmin=false` のときだけ
   * `href` の代わりに使う。表示・並び・active 判定は共通で、行き先だけを
   * role で振り分けるタブに使う（現状「メール」のみ）。
   */
  memberHref?: string
  /**
   * guest-role: ゲストにも見せるタブか。既定 false（会員・管理者専用）。
   * ゲストは許可リスト（`isGuestAllowedPath`）で `/events` と `/settings`
   * のみ開けるため、ナビもそれに合わせて「大会」「設定」の2つだけを true
   * にする（requirements S3 / AC-8）。
   */
  guestVisible?: boolean
}

const TABS: readonly Tab[] = [
  { id: 'home', label: 'ホーム', href: '/dashboard', matches: ['/dashboard'] },
  {
    id: 'events',
    label: '大会',
    href: '/events',
    matches: ['/events'],
    guestVisible: true,
  },
  // entry-management: 大会申込進捗ボード。当初は管理者専用だったが閲覧を全員に
  // 開放した（ボード自体が表示専用）。申込の日常動線として「大会」の直後に置く。
  {
    id: 'entries',
    label: '申込管理',
    href: '/admin/entries',
    matches: ['/admin/entries'],
  },
  // senseki-stats (PR-2): 戦績 → 統計 に改称。href は /players 据え置き
  // （着地点＝選手検索）だが、配下の 4 セクション（選手検索/大会結果/ランキング/
  // 大会統計）は /players・/tournaments の 2 基底に分かれるため両方を active 判定。
  {
    id: 'players',
    label: '統計',
    href: '/players',
    matches: ['/players', '/tournaments'],
  },
  // mail-tournament-import (PR1): apps/mail-worker が取り込んだ受信メール。
  // 未処理バッジを持つ日常動線なのでナビに残す。
  // member-mail-search: 一般会員にも開放した（会員側は読み取り専用の別画面
  // `/mail`）。設定ハブ配下に埋めると日常導線として見つからず検索機能の価値が
  // 出ないため、`/admin/entries` を開放したときと同じくタブとして出す。
  // 表示・並び・active 判定は共通で、行き先だけ role で振り分ける。
  {
    id: 'mail-inbox',
    label: 'メール',
    href: '/admin/mail-inbox',
    memberHref: '/mail',
    matches: ['/admin/mail-inbox', '/mail'],
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
    guestVisible: true,
  },
]

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export interface BottomNavProps {
  /**
   * Whether the current user is admin/vice_admin. 現在 `adminOnly` のタブは
   * 無く、この値は「メール」タブの遷移先の振り分けにだけ効く
   * (`/admin/mail-inbox` か会員向けの `/mail` か)。
   */
  isAdmin: boolean
  /**
   * role-preview-switch: プレビュー中の表示ロール名（例 `'一般会員'`）。
   * 非プレビュー時は null。上部バー廃止でバッジの居場所が無くなったため、
   * 切替を行う場所と同じ「設定」タブの上に出す。
   */
  previewRoleLabel?: string | null
  /**
   * guest-role: 実効ロールがゲストか。true のときは `guestVisible` な
   * タブ（大会・設定）だけを描画する。既定 false。
   */
  isGuest?: boolean
}

/**
 * Sticky mobile bottom tab bar. Tabs are 52px tall; the `<nav>` itself
 * reserves `52px + env(safe-area-inset-bottom)` so the bg-surface fill
 * extends into the iOS home-indicator area without compressing the tap
 * targets. Tabs: ホーム / 大会 / 申込管理 / 統計 / メール / 設定 を全員に
 * （member-mail-search で「メール」を開放し、一般会員も管理者も 6 タブ）。
 * 「メール」だけ遷移先が role で分かれる（管理者 `/admin/mail-inbox` /
 * 一般会員 `/mail`）。
 *
 * guest-role: `isGuest` のときは上記から「大会」「設定」の2タブだけに
 * 絞る（requirements S3 / AC-8）。ゲストは許可リスト
 * （`isGuestAllowedPath`）でこの2つ以外を開けないため、ナビも一致させる。
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
  isGuest = false,
}: BottomNavProps) {
  const pathname = usePathname() ?? ''
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin).filter(
    (tab) => !isGuest || tab.guestVisible,
  )
  // `shadow-nav` は高度の段 2（上向き）。コンテンツがナビの下へ潜って
  // 見えるようにするためで、枠線だけだと同一平面に見える。`isolate` は
  // ナビ自身のスタッキングコンテキストを作り、内側の要素（プレビュー
  // バッジ等）の z-index がページ側へ抜けないよう封じ込める（PR #529 で
  // `relative` だけではコンテキストが作られない件を踏んでいる）。
  return (
    <nav className="isolate min-h-[calc(52px_+_env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] flex-shrink-0 flex items-stretch bg-surface border-t border-border-soft shadow-nav">
      {visibleTabs.map((tab) => {
        const active = tab.matches.some((prefix) =>
          matchesPath(pathname, prefix),
        )
        // `isAdmin` は `session.user.role`（＝実効ロール）由来なので、管理者が
        // 一般会員プレビュー中は memberHref 側が選ばれる。プレビューの目的
        // （会員に何が見えるか）と一致する挙動。
        const href = !isAdmin && tab.memberHref ? tab.memberHref : tab.href
        const showPreviewBadge = tab.id === 'settings' && !!previewRoleLabel
        return (
          <Link
            key={tab.id}
            href={href}
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
