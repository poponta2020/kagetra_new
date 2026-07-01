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
    <nav
      aria-label="統計セクション"
      className="flex items-stretch border-b border-border bg-surface"
    >
      {SECTIONS.map((s) => {
        const active = s.href === current
        return (
          <Link
            key={s.id}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className="flex flex-1 items-center justify-center py-2.5 text-[13px]"
          >
            <span
              className={cn(
                'inline-block rounded-[2px] border-b-[2.5px] pb-1 transition-colors',
                active
                  ? 'border-brand font-medium text-brand'
                  : 'border-transparent text-ink-meta',
              )}
            >
              {s.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
