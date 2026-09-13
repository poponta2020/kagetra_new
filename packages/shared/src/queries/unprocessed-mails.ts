import { and, count, ne, notInArray } from 'drizzle-orm'
import { mailMessages } from '../schema'
import {
  loadInFlightResultImportMailIds,
  type ResultImportDbLike,
  type ResultImportVisibilityOptions,
} from './result-import-visibility'

/**
 * 未処理メール件数の**唯一の定義**（tournament-results 2026-09-13 改修）。
 *
 * 一覧・`/api/admin/mail/unprocessed-count`・mail-worker の Web Push badge
 * （`notifyNewMailPush` / `notifyExtractCompleted` / `notifyResultParseCompleted`）が
 * これを共有する。述語を書き写すとバッジだけ取込中を数えて一覧とズレる（要件 §3.6）。
 *
 * ★senseki-boundary の配線点はここ 1 箇所（`mail-history.queries.ts` と同じ役割）。
 * 配布版で結果取込ドメインを落とすときは `result-import-visibility.ts` を削除し、
 * 下の import と `hiddenMailIds` の 1 行を `const hiddenMailIds: number[] = []` に
 * 置き換える。素の `triage_status != 'processed'` へ縮退する。
 */
export async function countUnprocessedMails(
  dbc: ResultImportDbLike,
  opts?: ResultImportVisibilityOptions,
): Promise<number> {
  // ★senseki-boundary: 削除時はこの 1 行を `const hiddenMailIds: number[] = []` へ。
  const hiddenMailIds = await loadInFlightResultImportMailIds(dbc, opts)

  const unprocessed = ne(mailMessages.triageStatus, 'processed')
  // 空配列の notInArray は drizzle が壊れる（memory feedback_drizzle_sql_int_array_binding）。
  const where =
    hiddenMailIds.length > 0
      ? and(unprocessed, notInArray(mailMessages.id, hiddenMailIds))
      : unprocessed

  const [row] = await dbc.select({ value: count() }).from(mailMessages).where(where)
  return row?.value ?? 0
}
