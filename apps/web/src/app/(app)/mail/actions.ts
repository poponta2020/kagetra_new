'use server'

import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { searchMemberMails, type MailSearchRow } from '@/lib/member-mail/search'
import { loadHistories } from '@/lib/mail-history.queries'
import type { HistoryRow } from '@/lib/mail-history'

/**
 * member-mail-search タスク4: `/mail` 一覧の追加読込用 Server Action
 * （requirements.md §3.3・AC-8）。`players/ranking/actions.ts` と同じ方針を踏襲する。
 */

const PAGE_SIZE = 20

export interface MailListItem {
  row: MailSearchRow
  /** 処理履歴の最新1行（履歴が無ければ null）。一覧カードの `↳` 行に使う。 */
  historySummary: HistoryRow | null
}

/** 検索結果ぶんの履歴を一括取得し、各メールの最新1行だけを添えて返す（N+1 禁止）。 */
async function attachHistorySummaries(rows: MailSearchRow[]): Promise<MailListItem[]> {
  const historyMap = await loadHistories(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((row) => {
    const history = historyMap.get(row.id) ?? []
    return {
      row,
      historySummary: history.length > 0 ? (history[history.length - 1] ?? null) : null,
    }
  })
}

/**
 * 「もっと読み込む」用: 次ページ（offset 以降の20件）を検索結果＋履歴サマリまで合成して
 * 返す。全ログインユーザー向け（`/mail` の audience）なので auth 済みのみ許可。未認証は
 * ページ本体と同じく `/auth/signin` へ redirect する（空配列を返すと `MailList` の
 * 「もっと読み込む」判定が消えず失敗を繰り返せてしまうため）。
 *
 * `q` / `attachmentsOnly` はクライアントが改変できる信頼できない入力だが、
 * `searchMemberMails` がデータアクセス境界で安全に扱う（`ILIKE` エスケープ・limit/offset
 * のクランプ）。ここで別途検証は重ねない。
 */
export async function loadMoreMails(
  q: string,
  attachmentsOnly: boolean,
  offset: number,
): Promise<MailListItem[]> {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { rows } = await searchMemberMails({
    q,
    attachmentsOnly,
    limit: PAGE_SIZE,
    offset,
  })
  return attachHistorySummaries(rows)
}
