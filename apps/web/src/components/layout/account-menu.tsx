'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export interface AccountMenuProps {
  /**
   * Formatted display label shown as the trigger, e.g. `'山田さん'`. May be
   * an empty string when the session has no display name — a `メニュー`
   * fallback label keeps the tap target usable.
   */
  user: string
  /**
   * Whether the signed-in user is admin/vice_admin. Gates the admin-only
   * メール通知 (Web Push) entry so the sheet mirrors the
   * `/settings/notifications` page's own /403 gate.
   */
  isAdmin: boolean
  /** Logout Server Action, forwarded from `(app)/layout.tsx`. */
  signOutAction: () => Promise<void>
}

/**
 * Header account/settings entry point. Renders the `{name}さん` label as a
 * tappable trigger that opens a bottom sheet — the settings affordance
 * specified in `docs/design/design.md` §3 ("設定は `{name}さん` をタップして
 * シート"). Until now the label was static text and the two settings pages
 * (`/settings/notifications`, `/settings/line-link`) had no UI entry point.
 *
 * Follows the hand-rolled bottom-sheet pattern of `InviteCodeModal` /
 * `ManualLinkModal` (no Radix/shadcn dependency): a `bg-black/40` backdrop
 * with a panel pinned to the bottom on mobile (`items-end`) and centered on
 * `sm+`. The panel reserves `env(safe-area-inset-bottom)` on mobile so its
 * contents clear the iOS home indicator (the sheet sits flush to the bottom
 * edge there). The safe-area inset is composed inside a Tailwind arbitrary
 * value with `_`-escaped spaces so it survives as valid CSS.
 *
 * Client component: owns the open/close state and a keydown listener.
 */
export function AccountMenu({ user, isAdmin, signOutAction }: AccountMenuProps) {
  const [open, setOpen] = useState(false)

  // Dismiss on Escape. InviteCodeModal/ManualLinkModal only close on backdrop
  // + ×; this sheet is reachable from every screen's header, so keyboard
  // dismissal is worth the extra listener.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const close = () => setOpen(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="text-xs text-ink-meta hover:text-brand transition-colors"
      >
        {user || 'メニュー'}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="設定"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={close}
        >
          <div
            className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] sm:pb-4 flex flex-col gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 pb-2">
              <div className="flex flex-col">
                <h2 className="text-base font-semibold text-ink-1">設定</h2>
                {user ? (
                  <span className="text-[11px] text-ink-meta">{user}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                className="text-ink-meta hover:text-ink-1 text-xl leading-none"
              >
                ×
              </button>
            </header>

            <nav className="flex flex-col">
              {isAdmin ? (
                <Link
                  href="/settings/notifications"
                  onClick={close}
                  className="flex items-center justify-between rounded-lg px-2 py-3 text-sm text-ink-1 hover:bg-surface-alt transition-colors"
                >
                  メール通知
                  <span aria-hidden className="text-ink-meta">
                    ›
                  </span>
                </Link>
              ) : null}
              <Link
                href="/settings/line-link"
                onClick={close}
                className="flex items-center justify-between rounded-lg px-2 py-3 text-sm text-ink-1 hover:bg-surface-alt transition-colors"
              >
                LINE アカウント切替
                <span aria-hidden className="text-ink-meta">
                  ›
                </span>
              </Link>
            </nav>

            <div className="mt-1 border-t border-border pt-1">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-lg px-2 py-3 text-left text-sm text-ink-2 hover:bg-surface-alt transition-colors"
                >
                  ログアウト
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
