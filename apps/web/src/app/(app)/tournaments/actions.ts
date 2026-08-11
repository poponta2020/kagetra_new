'use server'

import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isGuestRole } from '@/lib/guest-access'
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
  // ページ側の /403 ガードは画面遷移しか塞がない。この action は許可パス
  // （/events 等）から任意の Server Action ID で直接呼べるため、ここでも
  // 同じロール判定を重ねる。
  if (isGuestRole(session.user?.role)) redirect('/403')
  const { rows } = await getTournamentList(query, undefined, 200, offset)
  return rows
}
