import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { searchMemberMails } from '@/lib/member-mail/search'
import { loadHistories } from '@/lib/mail-history.queries'
import { MailSearchBar } from './MailSearchBar'
import { MailList } from './MailList'
import type { MailListItem } from './actions'
import { isGuestRole } from '@/lib/guest-access'

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
  // Next.js App Router は同名 query の複数指定を配列で渡す（`?q=九段&q=大会`）。
  // 型を `string` に決め打ちすると `q.split(...)` が TypeError になり 500 に
  // なるため、配列も受けて先頭値へ正規化する（ranking ページと同じ規約）。
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  // guest-role: ゲストは会員向け画面に入れない（許可リスト。middleware の
  // 早期ゲートに加えた Node 側の実防御 — Edge の JWT role は降格直後 stale
  // になりうる）。requirements R2 / AC-10
  if (isGuestRole(session.user?.role)) redirect('/403')

  const params = await searchParams
  const query = firstParam(params.q) ?? ''
  const attachmentsOnly = firstParam(params.att) === '1'

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
      {/*
        key に検索条件を載せて条件変更時に再マウントさせる（`players/ranking/page.tsx`
        と同じ手当て）。同一セグメント内の遷移では App Router が Client Component の
        state を保持するため、key が無いと `useState(initialItems)` が新しい
        initialItems を取り込まず、件数だけ更新されて一覧は前の検索結果のまま残る。
        その状態で追加読込すると新しい条件＋古い items.length の offset が送られ、
        結果がさらに崩れる。検索バー側も同じ key で入力値を条件に追随させる
        （ブラウザの戻る/進むで入力欄と一覧がずれないようにする）。
      */}
      <div className="sticky top-0 z-10 border-b border-border-soft bg-canvas px-4 pt-2.5 pb-2">
        <MailSearchBar
          key={from}
          initialQuery={query}
          attachmentsOnly={attachmentsOnly}
          total={total}
        />
      </div>
      <div className="flex flex-col gap-2 px-4 pt-2.5 pb-6">
        <MailList
          key={from}
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

/** 同名 query が複数指定されたときは先頭値を採る（Next.js は配列で渡す）。 */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
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
