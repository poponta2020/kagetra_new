'use server'

import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPlayerRanking, type RankingMetric, type RankingRow } from '@/lib/stats/ranking'
import type { StatsFilter } from '@/lib/stats/types'

/**
 * 「もっと見る」用：次ページ（offset 以降の TOP 100）を返す Server Action。
 * 全ログインユーザー向け（統計タブの audience）なので auth 済みのみ許可。未認証（例：セッション
 * 期限切れ後にボタンを押す）は**ページ本体と同じく** `/auth/signin` へ redirect する。空配列を
 * 返すと RankingList の「もっと見る」（rows.length < total 判定）が消えず失敗を繰り返せるため。
 *
 * この引数（metric/filter/offset）はクライアントが改変できる信頼できない入力だが、
 * `getPlayerRanking` がデータアクセス境界で許可リスト/範囲に丸める（不正 metric は既定へ、
 * enum 外 grade・NaN 年・負 offset は除外/クランプ）。ここで別途検証は重ねない＝単一 choke
 * point に集約する。
 */
export async function loadMoreRanking(
  metric: RankingMetric,
  filter: StatsFilter,
  offset: number,
): Promise<RankingRow[]> {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  const { rows } = await getPlayerRanking(metric, filter, 100, offset)
  return rows
}
