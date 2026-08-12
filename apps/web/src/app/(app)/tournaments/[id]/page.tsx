import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getTournamentResults, sortBlocks } from '@/lib/stats/results'
import { TournamentDetailTabs } from './TournamentDetailTabs'
import { isGuestRole } from '@/lib/guest-access'

export const dynamic = 'force-dynamic'

/**
 * /tournaments/[id] — 大会詳細（入賞者タブ＋級クロス表）。requirements §3.4・design-spec §3.5。
 * プッシュ表示のため SectionTabs は出さず戻る導線のみ。`?from=` があればその内部パスへ戻る
 * （シリーズ詳細/一覧どちらから来ても自然に戻れる）。無ければ大会一覧へ。
 */
export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  // guest-role: ゲストは会員向け画面に入れない（許可リスト。middleware の
  // 早期ゲートに加えた Node 側の実防御 — Edge の JWT role は降格直後 stale
  // になりうる）。requirements R2 / AC-10
  if (isGuestRole(session.user?.role)) redirect('/403')

  const { id } = await params
  // 動的セグメントは 10 進整数のみを正規 URL とする（`1.0`/`1e3` 等の非正規表現は 404）。
  if (!/^\d+$/.test(id)) notFound()
  const results = await getTournamentResults(Number(id))
  if (!results) notFound()

  const sp = await searchParams
  const back = safeInternalPath(firstParam(sp.from)) ?? '/tournaments'
  const blocks = sortBlocks(results.blocks)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link href={back} className="text-sm text-brand">
          ‹ 大会結果へ戻る
        </Link>
        <h1 className="mt-1 font-display text-xl font-bold text-ink">{results.name}</h1>
        {(results.eventDate || results.venue) && (
          <p className="text-xs text-ink-meta">
            {[results.eventDate ? results.eventDate.replaceAll('-', '/') : null, results.venue]
              .filter(Boolean)
              .join(' ・ ')}
          </p>
        )}
      </div>

      {blocks.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-meta">この大会の結果データがありません。</p>
      ) : (
        <TournamentDetailTabs blocks={blocks} />
      )}
    </div>
  )
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** `?from=` は内部パス（`/` 始まり・`//` でない）だけ許可（オープンリダイレクト防止）。 */
function safeInternalPath(v: string | undefined): string | undefined {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : undefined
}
