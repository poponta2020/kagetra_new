import type { ReactNode } from 'react'
import { BottomNav } from './bottom-nav'

export interface MobileShellProps {
  /**
   * Whether the signed-in user has admin/vice_admin privileges. Forwarded
   * to `BottomNav` to gate admin-only tabs.
   */
  isAdmin: boolean
  /**
   * role-preview-switch: プレビュー中の表示ロール名（例 `'一般会員'`）。
   * `BottomNav` の「設定」タブのバッジへ素通しするだけ。非プレビュー時は null。
   */
  previewRoleLabel?: string | null
  children: ReactNode
}

/**
 * Mobile-first application shell. Fits the visible viewport via `h-dvh`
 * (with `h-screen` fallback for older browsers) so BottomNav stays pinned
 * at the bottom flex edge and only `<main>` scrolls — keeping the 52px
 * bottom tab bar visible regardless of page length or iOS Safari URL-bar
 * collapse.
 *
 * nav-settings-hub: かつて上端にあった 44px の AppBar（ワードマーク＋
 * `{name}さん` の設定シートトリガー）は廃止した。中身の情報価値に対して
 * 常時 44px を占有するコストが見合わず、設定は「設定」タブ →`/settings`
 * へ移した。シェルの子は `<main>` と `<nav>` の 2 つだけ。
 *
 * Intentionally NO responsive (`md:` / `lg:`) modifiers and NO `max-w-*`
 * constraints — the design is mobile-only by specification. Admin tables
 * that need a wider layout scope their own `max-w-5xl` per-page.
 *
 * Server component; client-only bits (pathname-aware tab highlighting)
 * live inside `BottomNav`.
 */
export function MobileShell({
  isAdmin,
  previewRoleLabel = null,
  children,
}: MobileShellProps) {
  // Height is supplied by the `.mobile-shell-h` rule in globals.css, which
  // declares `height: 100vh; height: 100dvh; height: 100svh;` in that
  // order inside a single CSS rule. The cascade picks the last
  // declaration the browser understands — modern UA → `100svh` wins,
  // older UA fall back to dvh or vh. We can't compose this via Tailwind
  // utilities (`h-screen h-dvh h-svh`) because Tailwind's utility output
  // order is NOT controlled by className order — same-property utilities
  // may emit in any order, so the winning value can't be guaranteed
  // (PR #68 R1 Codex blocker).
  //
  // Why `100svh` is the final winner: iOS Safari (15.4+) with
  // `viewport-fit=cover` returns a `100dvh` value that *includes* the
  // bottom URL bar overlay, making the shell taller than the visible
  // safe area and pushing BottomNav under the URL bar (PR #67 production
  // bug). `100svh` is the conservative "always visible" height — UA
  // chrome fully shown — that keeps BottomNav above the URL bar at the
  // cost of an extra empty band when the URL bar later collapses.
  return (
    <div className="mobile-shell-h flex flex-col bg-canvas text-ink font-sans">
      {/*
        `min-h-0` is required: flex items default to `min-height: auto`,
        which prevents <main> from shrinking below its content height even
        with `overflow-y-auto`. Without it the inner content pushes <main>
        past the shell, the shell bleeds past h-dvh, and body scroll
        carries BottomNav off-screen — exactly the bug we are trying
        to fix. See https://developer.mozilla.org/en-US/docs/Web/CSS/min-height#values
      */}
      {/*
        `overscroll-none` (= `overscroll-behavior: none`) は上下端でのラバー
        バンド（引っ張ると伸びて戻る挙動）と、親へのスクロール連鎖の両方を
        止める。html/body 側の同指定（globals.css の Baseline）はドキュメント
        自体のバウンスを止めるもので、実スクローラーであるこの <main> の内側は
        こちらでないと止まらない（2 箇所セットで初めて効く）。
      */}
      <main className="flex-1 min-h-0 overflow-y-auto overscroll-none">
        {children}
      </main>
      <BottomNav isAdmin={isAdmin} previewRoleLabel={previewRoleLabel} />
    </div>
  )
}
