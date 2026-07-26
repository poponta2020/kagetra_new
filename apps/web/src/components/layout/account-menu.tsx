'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Pill } from '@/components/ui'
import { roleViewLabel } from '@/lib/role-preview'
import type { RolePreviewSelection } from '@/lib/role-preview'

/**
 * 「表示ロール」セクションの入力。`(app)/layout.tsx` が
 * `buildRolePreviewSelection()` で算出して渡す。
 */
export type RolePreviewProps = RolePreviewSelection

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
  /**
   * role-preview-switch: 表示ロール切替セクションの入力。`ROLE_PREVIEW_USER_IDS`
   * で許可されたユーザー以外は `null`（このときセクション自体を描画しない）。
   */
  rolePreview?: RolePreviewProps | null
  /**
   * role-preview-switch: プレビュー中のみ非 null。トリガーボタン内にバッジ
   * として表示する（AC-13）。
   */
  previewBadge?: string | null
  /**
   * role-preview-switch: 表示ロール切替の Server Action。`rolePreview` が
   * 非 null のときだけ「表示ロール」セクションを描画する条件に使う。
   */
  setRolePreviewAction?: ((formData: FormData) => Promise<void>) | null
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
export function AccountMenu({
  user,
  isAdmin,
  signOutAction,
  rolePreview = null,
  previewBadge = null,
  setRolePreviewAction = null,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  // 表示ロール切替後に戻すパス。`usePathname()` はクエリ文字列を落とすため
  // 使わない（ランキング・大会統計・選手検索は searchParams が状態の唯一の
  // ソースなので、切替でフィルタが消えてしまう）。`useSearchParams()` は
  // このコンポーネントが (app) レイアウト直下にある都合上、配下の全ページに
  // Suspense 境界を要求してしまうのでこれも使わない。シートはクリック起点
  // でしか開かず SSR されないため、開く瞬間に window から読めば足りる。
  const [returnTo, setReturnTo] = useState('/')

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

  // 表示ロールを切り替えたらシートを閉じる。切替ボタンの onClick で
  // close() を呼ぶことはできない — クリック処理の中で portal ごと form が
  // DOM から外れると、ブラウザが既定動作（フォーム送信）を中止してしまい
  // 「押しても何も起きない」になる。サーバー側の再描画で current が
  // 変わったことを検知して閉じる。
  const currentPreviewRole = rolePreview?.current
  useEffect(() => {
    setOpen(false)
  }, [currentPreviewRole])

  const close = () => setOpen(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReturnTo(`${window.location.pathname}${window.location.search}`)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-ink-meta hover:text-brand transition-colors"
      >
        {previewBadge ? (
          <Pill tone="brand" size="sm">
            {previewBadge}
          </Pill>
        ) : null}
        {user || 'メニュー'}
      </button>

      {/* Portal + .modal-overlay-h (svh cascade): 祖先の stacking context を脱出し、
          iOS viewport-fit=cover の dvh 罠を svh で回避（RankingFilterBar の同コメント参照）。
          open はクリック起点でしか true にならないので SSR で portal は走らない。 */}
      {open ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="設定"
          className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={close}
        >
          <div
            className="max-h-full overflow-y-auto w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] sm:pb-4 flex flex-col gap-1"
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

            {rolePreview && setRolePreviewAction ? (
              <div className="mt-1 border-t border-border pt-2">
                <p className="px-2 pb-1 text-xs text-ink-meta">表示ロール</p>
                <form action={setRolePreviewAction} className="flex flex-col">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {rolePreview.selectable.map((role) => (
                    <button
                      key={role}
                      type="submit"
                      name="role"
                      value={role}
                      aria-current={rolePreview.current === role ? 'true' : undefined}
                      className="flex items-center justify-between rounded-lg px-2 py-3 text-left text-sm text-ink-1 hover:bg-surface-alt transition-colors"
                    >
                      {roleViewLabel(role)}
                    </button>
                  ))}
                </form>
              </div>
            ) : null}

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
        </div>,
        document.body,
      ) : null}
    </>
  )
}
