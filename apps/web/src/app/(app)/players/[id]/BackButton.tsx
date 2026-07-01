'use client'

import { useRouter } from 'next/navigation'

/**
 * 「← ランキングへ戻る」導線（④）。押下で `router.back()` し、直前のランキング画面へ戻す
 * ＝絞り込み条件（前 URL）とスクロール位置を可能な範囲で復元する。
 *
 * `href` は「ランキング絞り込みを再構成した URL」で、中クリック/修飾キー/JS 無効/履歴が無い
 * （直リンク流入）ときの通常遷移先になる（アンカーの href 属性 + フォールバック push）。
 * 通常のランキング→詳細フローでは history に前 URL があるので back() が確実に効く。
 */
export function BackButton({ href, label }: { href: string; label: string }) {
  const router = useRouter()
  return (
    <a
      href={href}
      className="text-sm text-brand-fg"
      onClick={(e) => {
        // 中クリック/修飾キーは新規タブ等をブラウザに任せる（既定遷移を奪わない）。
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return
        }
        e.preventDefault()
        // 履歴があれば戻る（前 URL のフィルタ＋スクロールを復元）。無ければ href へ遷移。
        if (typeof window !== 'undefined' && window.history.length > 1) router.back()
        else router.push(href)
      }}
    >
      {label}
    </a>
  )
}
