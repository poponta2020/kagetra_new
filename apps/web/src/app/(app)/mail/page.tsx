import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { searchMemberMails } from '@/lib/member-mail/search'
import { loadHistories } from '@/lib/mail-history.queries'
import { MailSearchBar } from './MailSearchBar'
import { MailList } from './MailList'
import type { MailListItem } from './actions'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

/**
 * /mail — 会員向け受信メール検索・一覧（requirements.md §3.1 S1・design-spec.md §3/§7）。
 *
 * 権限は「ログイン済みか」だけ（role は見ない。AC-2。`/admin/entries` 開放と同じ形）。
 * 完全な読み取り専用。ルート要素は全幅（`players/page.tsx` と同じ sticky 検索バーの
 * ページなので `p-4` を付けない。`page-padding.test.ts` の TARGET_PAGES に含めない）。
 */
export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; att?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { q, att } = await searchParams
  const query = q ?? ''
  const attachmentsOnly = att === '1'

  const { rows, total } = await searchMemberMails({
    q: query,
    attachmentsOnly,
    limit: PAGE_SIZE,
    offset: 0,
  })
  const historyMap = await loadHistories(
    db,
    rows.map((r) => r.id),
  )
  const items: MailListItem[] = rows.map((row) => {
    const history = historyMap.get(row.id) ?? []
    return {
      row,
      historySummary: history.length > 0 ? (history[history.length - 1] ?? null) : null,
    }
  })

  const from = buildMailPath(query, attachmentsOnly)

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-border-soft bg-canvas px-4 pt-2.5 pb-2">
        <MailSearchBar initialQuery={query} attachmentsOnly={attachmentsOnly} total={total} />
      </div>
      <div className="flex flex-col gap-2 px-4 pt-2.5 pb-6">
        <MailList
          initialItems={items}
          total={total}
          q={query}
          attachmentsOnly={attachmentsOnly}
          from={from}
        />
      </div>
    </div>
  )
}

/** 現在の検索条件を表す `/mail` パス（添付ビューアの `?from=` に使う）。 */
function buildMailPath(q: string, attachmentsOnly: boolean): string {
  const params = new URLSearchParams()
  const trimmed = q.trim()
  if (trimmed) params.set('q', trimmed)
  if (attachmentsOnly) params.set('att', '1')
  const qs = params.toString()
  return qs ? `/mail?${qs}` : '/mail'
}
