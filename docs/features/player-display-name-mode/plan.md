# 実装計画: players.display_name を「代表表記（最頻の生表記）」へ

- 方針②（ユーザー承認済み 2026-06-24）。memory: `project_player_name_display_mode`
- 関連: `impl_tournament_results` / `project_bulk_load_handover`

## 背景 / 目的

選手マスタ `players.display_name` が現状 first-wins（最初に取り込まれた表記で固定）。
生データ `tournament_participants.name` は「山﨑」なのに表示が「山崎」へ化けるケースが実データで 140 件。
これを **その選手の全 participations 横断の最頻表記（mode）** に変える。

- **正規化（`normalizePlayerName`）は維持**（同定キー `normalized_name` と検索の両方）。検索は異体字非依存のまま。
- **同定キー `(normalized_name, affiliation)` は不変 → migration なし**。
- `participants.name` はロスレスのまま（生データ層は触らない）。

## スコープ

In:
1. 再計算関数 `recomputePlayerDisplayNames(db, playerIds?)`（1 SQL）
2. `materializeResultDraft` 末尾で touched player を再計算（bulk/live 両対応）
3. 既存行向け backfill スクリプト（冪等・--dry-run）

Out（やらない）:
- `normalizePlayerName` / `normalized_name` / UNIQUE キー / migration の変更
- `searchPlayers` のマッチ方式変更（normalized_name 一致のまま）
- participants.name の改変、ついでリファクタ

## Phase 0: Allowed APIs / 確定事実（読込済み・引用元つき）

### コード入口・型
- `materializeResultDraft(tx, payload, opts)` … [materialize.ts:39-202](../../../apps/web/src/lib/result-import/materialize.ts)。caller の tx 内で実行。
  - player get-or-create: SELECT→INSERT `.onConflictDoNothing()`→re-SELECT（[materialize.ts:99-143](../../../apps/web/src/lib/result-import/materialize.ts)）。`displayName: p.name`（line 118）が first-wins の発生源。
  - participant 挿入で `name: p.name`（raw, line 154）, `playerId` 紐付け（line 149）。
  - **追加ポイント**: 関数先頭で `const touched = new Set<number>()`、participant ループ内 `touched.add(playerId)`（line 161 付近）、class ループ後・`return` 前（line 200 付近）で `await recomputePlayerDisplayNames(tx, [...touched])`。
- 呼び出し元（改修不要・末尾 recompute を継承）:
  - bulk loader `apps/web/_rehearse_load.mts:138-148`（per-tournament・`db.transaction` 内、git外scratch）
  - 本番 `approveResultDraft` … `apps/web/src/app/(app)/admin/mail-inbox/actions.ts:1443`（`db.transaction`＋FOR UPDATE 内）
- DbLike 型は materialize.ts と同じ `NodePgDatabase<typeof schema>`（tx でも main db でも可）。

### スキーマ（変更なし・参照のみ）
- `players`（display_name / normalized_name / affiliation / updated_at）… [players.ts](../../../packages/shared/src/schema/players.ts)
- `tournament_participants`（name=raw / class_id / player_id）… index `idx_participants_player_id` あり
- `tournament_classes`（class_id→tournament_id）, `tournaments`（event_date）

### Drizzle / SQL
- drizzle-orm ^0.45。`db.execute(sql\`...\`)` で raw SQL 可。`sql` は `drizzle-orm` から。
- **アンチパターン**: Postgres `mode() WITHIN GROUP` は tiebreak 制御不可 → 使わない。ranked CTE で実装。
- player id 配列は `inArray` または `ANY(${...}::int[])` で確実にパラメータ化（リポジトリ初の複雑 SQL）。

### テスト基盤
- DB ヘルパ `@/test-utils/db`（`testDb`, `truncateAll()`, `closeTestDb()`）。`beforeEach(truncateAll)` / `afterAll(closeTestDb)`。
- `truncateAll` は RESTART IDENTITY（id 決定的）。
- 実行: `pnpm --filter @kagetra/web test`（`vitest run`、`fileParallelism:false`）。
- fixture: `ParsedResultPayload`（parserVersion, classes[]）。materialize 呼び出しは `await testDb.transaction(tx => materializeResultDraft(tx, payload, opts))`。雛形 = [materialize.test.ts](../../../apps/web/src/lib/result-import/materialize.test.ts) L22-160、[queries.test.ts](../../../apps/web/src/lib/players/queries.test.ts) L1-71。
- スクリプト雛形 = `apps/web/scripts/cleanup-expired-tokens.ts`（dotenv→Pool→`drizzle(pool,{schema})`→main()→CLI guard→`pool.end()` in finally）。実行 `pnpm --filter @kagetra/web exec tsx scripts/<name>.ts [--dry-run]`。

## 再計算アルゴリズム（確定仕様）

対象 player ごとに `tournament_participants.name` を集計し以下の優先順で 1 つ選び `display_name` に採用:
1. 出現回数 `cnt` 降順（最頻）
2. `is_variant` 降順（`name <> normalized_name` を優先＝旧字/異体字を残す）
3. `latest` 降順（その表記が使われた最新 `event_date`、NULLS LAST）
4. `name` 昇順（決定的）

参照 SQL（実装の指針。`playerIds` 無指定なら WHERE を外して全件 backfill）:
```sql
WITH cand AS (
  SELECT tp.player_id, tp.name,
         COUNT(*) AS cnt,
         bool_or(tp.name <> pl.normalized_name) AS is_variant,
         MAX(t.event_date) AS latest
  FROM tournament_participants tp
  JOIN players pl ON pl.id = tp.player_id
  JOIN tournament_classes tc ON tc.id = tp.class_id
  JOIN tournaments t ON t.id = tc.tournament_id
  WHERE tp.player_id = ANY($1::int[])      -- backfill 時は省略
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
  AND p.display_name IS DISTINCT FROM r.name;   -- 変化分のみ更新
```
収束性: bulk では各大会の materialize が「その大会で触れた player」を、既コミット＋tx内の全 participation を見て再計算。最後にその player を触れた大会の recompute が全 participation を見るので、ロード完了時に display_name = 全期間の真の mode。

## Phase 1: recompute 関数 + テスト（テストファースト）

- 先にテスト `apps/web/src/lib/players/recompute-display-name.test.ts`:
  - A1: 同一 player を 2 大会で seed（「山﨑」×2 / 「山崎」×1）→ recompute 後 display_name = 「山﨑」。
  - A2: tie + 旧字優先（「髙橋」×1 /「高橋」×1、別大会）→「髙橋」。
  - A3: tie 同士が両方 variant → 最新 event_date の表記。
  - A4: 変化なしの player は更新されない（updated_at 不変）。
  - seed は materialize 経由（複数 tx）または直接 insert。`@/test-utils/db` 使用。
- 実装 `apps/web/src/lib/players/recompute-display-name.ts`: 上記 SQL を `db.execute(sql\`...\`)`。返り値=更新件数。
- 検証: 上記テスト green / `pnpm --filter @kagetra/web typecheck` / lint。grep で `mode(` `within group` 不使用を確認。

## Phase 2: materialize へ配線 + テスト

- `materialize.ts`: `recomputePlayerDisplayNames` を import、`touched` 集合を集めて末尾（return 前・tx 内）で呼ぶ。player 作成時の `displayName: p.name` は placeholder として残す（NOT NULL 充足、recompute が上書き）。
- テスト追加（materialize.test.ts かまたは新規）: 2 大会を別 tx で materialize し、同一 player の display_name が最頻表記になることを assert（end-to-end）。既存 materialize.test.ts の単一大会ケースが回帰しないことも確認。
- 検証: `pnpm --filter @kagetra/web test` green。呼び出し元（bulk/live）は無改修で挙動継承。

## Phase 3: backfill スクリプト

- `apps/web/scripts/backfill-player-display-name.ts`（雛形 cleanup-expired-tokens.ts）。`recomputePlayerDisplayNames(db)`（全件）を呼ぶ。`--dry-run` は更新予定件数のみ表示。
- 用途: 既にロード済みの環境（本番でメール承認由来の player が居る場合等）の是正。**新規ロードでは materialize が自己補正するため不要**だが冪等な保険として用意。
- 検証: リハ DB（5433/kagetra_rehearsal）で `--dry-run`→件数、実行→「生は﨑だが display が崎」140 件が解消することを Phase 4 の診断 SQL で確認。

## Phase 4: 最終検証

- `pnpm --filter @kagetra/web test`（全 green, fileParallelism:false） / `typecheck` / `lint`。
- アンチパターン grep ガード:
  - `apps/mail-worker/src/result-import/normalize.ts` に diff が無い（normalizePlayerName 不変）。
  - `packages/shared/drizzle/` に新規 migration が無い。
  - `searchPlayers` が `players.normalizedName` 一致のまま（queries.ts 不変 or 表示のみ）。
- 実データ検証（リハ DB）: 投入済み 320 大会に backfill→以下が 0 近傍へ:
  ```sql
  select count(*) from tournament_participants pa join players pl on pl.id=pa.player_id
  where pa.name like '%﨑%' and pl.display_name not like '%﨑%';
  ```
  併せて山﨑系 player の display_name が﨑で表示されることを spot check。

## リスク / 順序

- **順序前提**: 本番投入（過去結果 bulk）より先に本 PR をマージ。本番 tournament 系は現在空なので、最初のロードから正しい display で入り backfill 不要（[[project_bulk_load_handover]] は GO 待ちのまま）。
- 性能: bulk で大会ごとに recompute 1 SQL（touched ~270 player、`idx_participants_player_id` 利用）。全 1453 大会でも軽微。
- 1 PR = 1 機能（テスト＋recompute＋materialize 配線＋backfill）。
