import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'

// Works for both NodePgDatabase (main db) and NodePgTransaction (inside a tx
// callback) — same alias as materialize.ts:15.
type DbLike = NodePgDatabase<typeof schema>

/**
 * players.display_name を「その選手の全 participations 横断の最頻表記（mode）」に
 * 再計算する。`tournament_participants.name` は生データ（ロスレス）で常に正、
 * `players.display_name` は first-wins で固定された表示用の代表表記。これを真の
 * 最頻表記へ寄せ直す（例: 「山﨑」が大多数なのに first-wins で「山崎」化けした行を是正）。
 *
 * 採用順（plan.md「再計算アルゴリズム」§57-91 と一致）:
 *   1. cnt DESC          … 出現回数が最多の表記（最頻）
 *   2. is_variant DESC   … name <> normalized_name を優先（旧字/異体字「山﨑/髙橋」を残す）
 *   3. latest DESC NULLS LAST … その表記が使われた最新 event_date
 *   4. name ASC          … 完全に決定的にするための tiebreak
 *
 * Postgres の集約 mode 関数（ordered-set aggregate）は tiebreak を制御できない
 * ため使わず、ranked CTE（ROW_NUMBER）で 1 件に絞る（plan.md §47）。
 *
 * @param db        tx でも main db でも可（DbLike）。bulk は per-tournament の tx 内、
 *                  backfill スクリプトは main db で呼ぶ。
 * @param playerIds 指定時のみその player に絞る。**未指定なら全 player を backfill**。
 *                  空配列 `[]` は「対象なし」として SQL を実行せず 0 を返す
 *                  （`ANY('{}')` で全件更新してしまう事故を防ぐ early-return）。
 * @returns         display_name が実際に更新された player の件数。
 */
export async function recomputePlayerDisplayNames(
  db: DbLike,
  playerIds?: number[],
): Promise<number> {
  // 空配列ガード: scoped 呼び出しで対象が空なら何もしない。これを入れないと
  // 後段の `ANY(${[]}::int[])` が `ANY('{}')`（= 常に false の WHERE）にはなるが、
  // 「対象を絞ったつもりが 0 件マッチ」と「絞らず全件」を取り違える事故を断つため
  // 明示的に早期 return する（plan のタスク指示）。
  if (playerIds !== undefined && playerIds.length === 0) return 0

  // playerIds 指定時のみ WHERE で絞る。未指定（undefined）なら WHERE を外して
  // 全 player を対象にする（backfill）。
  //
  // 配列バインドの注意: drizzle の sql 補間に JS 配列をそのまま渡すと単一スカラ
  // パラメータ化され `ANY(($1)::int[])` が `"1"` を array literal として parse
  // しようとして `malformed array literal` で落ちる。要素ごとにプレースホルダを
  // 展開して `ANY(ARRAY[$1,$2,...]::int[])` を組む（各要素は確実にパラメータ化、
  // SQL インジェクション安全）。plan.md §48「inArray または ANY(${...}::int[])」
  // の inArray も内部は同じ要素展開方式。
  const scope =
    playerIds === undefined
      ? sql``
      : sql`WHERE tp.player_id = ANY(ARRAY[${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::int[])`

  // db.execute(sql`...`) は node-postgres drizzle では pg の QueryResult を返す
  // （node_modules/.../node-postgres/session.d.ts:57-59 NodePgQueryResultHKT）。
  // UPDATE 行数は QueryResult.rowCount（number | null）。
  const result = await db.execute(sql`
    WITH cand AS (
      SELECT tp.player_id, tp.name,
             COUNT(*) AS cnt,
             bool_or(tp.name <> pl.normalized_name) AS is_variant,
             MAX(t.event_date) AS latest
      FROM tournament_participants tp
      JOIN players pl ON pl.id = tp.player_id
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      ${scope}
      GROUP BY tp.player_id, tp.name
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY player_id
        ORDER BY cnt DESC, is_variant DESC, latest DESC NULLS LAST, name ASC
      ) AS rn
      FROM cand
    )
    UPDATE players p
    SET display_name = r.name, updated_at = now()
    FROM ranked r
    WHERE r.player_id = p.id AND r.rn = 1
      AND p.display_name IS DISTINCT FROM r.name
  `)

  return result.rowCount ?? 0
}
