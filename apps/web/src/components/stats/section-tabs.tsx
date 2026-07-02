'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Section {
  id: string
  label: string
  href: string
}

/**
 * 「統計」タブ配下の 4 セクション（design-spec §3.0 `ss-segA`）。
 * 順序は仕様どおり 選手検索／大会結果／ランキング／大会統計。
 *
 * 選手検索(`/players`) と ランキング(`/players/ranking`)、大会結果(`/tournaments`)
 * と 大会統計(`/tournaments/stats`) は親子プレフィックス関係にあるため、active は
 * **最長プレフィックス一致**で解決する（`activeHref` 参照）。
 */
const SECTIONS: readonly Section[] = [
  { id: 'players', label: '選手検索', href: '/players' },
  { id: 'tournaments', label: '大会結果', href: '/tournaments' },
  { id: 'ranking', label: 'ランキング', href: '/players/ranking' },
  { id: 'stats', label: '大会統計', href: '/tournaments/stats' },
]

/** 前方一致をセグメント境界で判定（exact もしくは `${href}/...`）。 */
function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

/**
 * 現在地に一致するセクションの href を返す。複数一致する場合は
 * **最長プレフィックス**を採用する（`/players/ranking` は `/players` にも
 * 一致するが、より具体的な `/players/ranking`=ランキングを勝たせる）。
 * どれにも一致しない場合は空文字。
 */
function activeHref(pathname: string): string {
  let best = ''
  for (const s of SECTIONS) {
    if (matchesPath(pathname, s.href) && s.href.length > best.length) {
      best = s.href
    }
  }
  return best
}

/**
 * 「統計」タブ配下の 4 セクション横断ナビ（均等 4 分割の下線タブ）。
 * 4 セクションの**トップ**（`/players`・`/tournaments`・`/players/ranking`・
 * `/tournaments/stats`、および大会結果の大会別トグル `/tournaments/series`）に
 * のみ配置し、戦績詳細・大会詳細・シリーズ詳細などのプッシュ画面には出さない
 * （requirements §3.1）。
 *
 * Client component（アクティブ判定に `usePathname()` を読む）。
 */
export function SectionTabs() {
  const pathname = usePathname() ?? ''
  const current = activeHref(pathname)
  return (
    // 統計 4 画面共通のセクションナビ。`MobileShell` の `<main>`（唯一のスクロール
    // コンテナ）の先頭に置かれるため、`sticky top-0` で下スクロール時も最上部
    // （44px の AppBar 直下）に固定される（design-spec §7-1・4 画面共通挙動）。
    // 高さは AppBar と同じ 44px（h-11）に固定＝選手検索の検索バー固定 top オフセット
    // （`top-11`）を確定値にするため。z-20 で本文・検索バー（z-10）より前面に置く。
    <nav
      aria-label="統計セクション"
      className="sticky top-0 z-20 flex h-11 items-stretch border-b border-border bg-surface"
    >
      {SECTIONS.map((s) => {
        const active = s.href === current
        return (
          // アクティブ下線は Link（タブ全幅・全高）に直接 border-b で付ける。nav は
          // items-stretch なので下線はタブ下辺にピタッと張り付き（浮かない）、幅もタブ全幅。
          // -mb-px で nav 自身の 1px 区切り線に重ね、下辺ラインとして揃える。
          <Link
            key={s.id}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 items-center justify-center border-b-[3px] text-[13px] transition-colors -mb-px',
              active
                ? 'border-brand font-medium text-brand'
                : 'border-transparent text-ink-meta',
            )}
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
