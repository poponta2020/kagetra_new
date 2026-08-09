import { and, eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { resultDrafts } from '@kagetra/shared/schema'
import type { HistoryRow } from './mail-history'

type DbLike = NodePgDatabase<typeof schema>

/**
 * mail-history H0（試合結果として取り込み）— requirements.md §3.4 H0。
 *
 * ★このファイルは `docs/audits/senseki-boundary-audit.md` の物理削除対象
 * （配布版から統計・戦績ドメインを切り離す際に丸ごと削除する）。判定・文言・クエリを
 * ここに1関数で閉じてあるので、削除は次の2箇所を外すだけで完結する:
 *   1. `mail-history.queries.ts` の `import { loadResultImportRows } from
 *      './mail-history.result-import'`
 *   2. `mail-history.queries.ts` の `loadHistories` 内で {@link loadResultImportRows}
 *      を呼んでいる1行
 * 削除後は該当メールが H0 を失って H4（対応不要として処理）に落ちるだけで、他の
 * 履歴行（H1〜H6）には影響しない（AC-33 で担保）。`mail-history.ts` はこのファイルに
 * 一切依存しない（type-only import も含めて逆方向の依存を持たない）。
 *
 * 大会名は出さない — `result_drafts` は `events` に素直に解決できないため
 * （requirements.md §3.4 H0）。
 */
export async function loadResultImportRows(
  dbc: DbLike,
  mailIds: readonly number[],
): Promise<Map<number, HistoryRow>> {
  const rows = new Map<number, HistoryRow>()
  if (mailIds.length === 0) return rows

  const approved = await dbc
    .select({ messageId: resultDrafts.messageId, approvedAt: resultDrafts.approvedAt })
    .from(resultDrafts)
    .where(and(inArray(resultDrafts.messageId, [...mailIds]), eq(resultDrafts.status, 'approved')))

  for (const draft of approved) {
    const segments: HistoryRow['segments'] = [{ type: 'text', value: '試合結果として取り込み' }]
    rows.set(draft.messageId, {
      kind: 'result_import',
      at: draft.approvedAt,
      segments,
      detail: null,
      note: null,
      summarySegments: segments,
    })
  }

  return rows
}
