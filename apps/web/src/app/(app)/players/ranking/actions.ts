'use server'

import { auth } from '@/auth'
import { getPlayerRanking, type RankingMetric, type RankingRow } from '@/lib/stats/ranking'
import type { StatsFilter } from '@/lib/stats/types'

/**
 * 「もっと見る」用：次ページ（offset 以降の TOP 100）を返す Server Action。
 * 全ログインユーザー向け（統計タブの audience）なので auth 済みのみ許可、
 * 未認証は空配列を返す（クライアントはそのまま打ち止めになる）。
 */
export async function loadMoreRanking(
  metric: RankingMetric,
  filter: StatsFilter,
  offset: number,
): Promise<RankingRow[]> {
  const session = await auth()
  if (!session) return []
  const { rows } = await getPlayerRanking(metric, filter, 100, offset)
  return rows
}
