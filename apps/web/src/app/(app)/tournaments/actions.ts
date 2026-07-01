'use server'

import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getTournamentList, type TournamentListRow } from '@/lib/stats/tournaments'

/**
 * 「もっと見る」用：年別ビューの次ページ（offset 以降）を返す Server Action。統計タブの
 * audience（全ログインユーザー）向けなので auth 済みのみ許可。未認証は `/auth/signin` へ。
 * 入力（query/offset）は信頼できないが `getTournamentList` が choke point でクランプするので
 * ここで別途検証は重ねない。
 */
export async function loadMoreTournaments(
  query: string | undefined,
  offset: number,
): Promise<TournamentListRow[]> {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  const { rows } = await getTournamentList(query, undefined, 200, offset)
  return rows
}
