---
status: completed
---
# senseki-stats 実装手順書

戦績→「統計」タブ再編（4セクション）。要件＝[requirements.md](./requirements.md)（completed）、
視覚＝[design-spec.md](./design-spec.md)（locked）。テストファースト（API→実装→フロント→実装→E2E）。
**5 PR に分割**（1PR=1機能）。migration は test/dev=push・本番=migrate（[[feedback_drizzle_kit_push_prompt]]）。
次期 migration 連番＝**0037**（現行 head=0036）。

## 実装タスク

**Issue 対応**（親 [#208](https://github.com/poponta2020/kagetra_new/issues/208)）: タスク1=#209 ／ 2=#210 ／ 3=#211 ／ 4=#212 ／ 5=#213 ／ 6=#214 ／ 7=#215 ／ 8=#216 ／ 9=#217 ／ 10=#218 ／ 11=#219

### タスク1: derived_bracket schema＋migration（PR-1 基盤）
- [x] 完了
- **概要:** `tournament_participants` に `derived_bracket smallint`（null 許容）を追加。ランキング集計
  （player 別 count＋年/級 join）用に index を付与。requirements §4.1/§4.3。
- **変更対象ファイル:**
  - `packages/shared/src/schema/tournament-participants.ts` — `derivedBracket: smallint('derived_bracket')`（nullable）追加
  - `packages/shared/drizzle/0037_*.sql` — `drizzle-kit generate` で生成（列追加＋index）
  - `packages/shared/drizzle/meta/*` — snapshot（prevId 連鎖＝0036 の次）
  - `packages/shared/__tests__/tournament-results-schema.test.ts` — 列存在の型/スキーマ確認を追記
- **依存タスク:** なし
- **完了条件:** 型チェック green・test/dev で push 適用・0037 が 0036 の次として journal に載る・既存テスト不破壊。

### タスク2: materialize で derived_bracket 書き込み（PR-1 基盤）
- [x] 完了
- **概要:** 取込承認（materialize）時に、級ごとに既存 `derivePlacement`（`lib/players/placement`）を回して各
  participant の `derived_bracket` を確定・保存。導出不能級は null（呼び出し側は保存済み `final_rank` に
  フォールバック）。順位定義は戦績詳細と単一ソース。
- **設計メモ:** `derivePlacement(matches, classMaxRound)` は級内の対戦（round/label/result/status）と級の
  決勝 round が必要。materialize は Pass1=participant / Pass2=match の順なので、パース済み `cls` から
  **級内の per-participant matches を組んで bracket を先に算出**し、participant insert（`finalRank` の隣・
  [materialize.ts:176](../../apps/web/src/lib/result-import/materialize.ts#L176)）に載せる（or Pass3 UPDATE）。
- **変更対象ファイル:**
  - `apps/web/src/lib/result-import/materialize.ts` — bracket 算出＋ `derivedBracket` を values に追加
  - `apps/web/src/lib/players/placement.ts` — 必要なら `cls`→per-participant matches のヘルパを追加（純関数）
  - `apps/web/src/lib/result-import/materialize.test.ts` — **先にテスト**：優勝=1／準優勝=2／ベストN／導出不能級=null（final_rank 温存）／walkover・forfeit の扱い
- **依存タスク:** タスク1
- **完了条件:** materialize テスト green（bracket 分岐網羅）・既存 result-import テスト不破壊・CI green。

### タスク3: derived_bracket 全件 backfill スクリプト（PR-1 基盤）
- [x] 完了
- **概要:** 既存 367,675 参加を一回限りで埋める。全級を走査 → `derivePlacement` → `UPDATE`。冪等・
  `--dry-run`・sentinel rollback（既存 `backfill-player-display-name.ts` / `backfill-dan-rank.ts` 踏襲）。
  本番反映は dump/apply（[[project_bulk_load_handover]]・series 層と同じく db:migrate 運用）。
- **変更対象ファイル:**
  - `apps/web/scripts/backfill-derived-bracket.ts` — 新規（tx＋バッチ＋--dry-run＋件数レポート）
  - `apps/web/scripts/backfill-derived-bracket.test.ts` — 任意（seed 級で優勝/入賞/null を検証）
- **依存タスク:** タスク2
- **完了条件:** `--dry-run` が変更件数を報告・rehearsal DB で全件 backfill 成功・再実行で差分0（冪等）・
  読み戻しで優勝/入賞数が妥当。**本番は投入待ち（worklog に残 DoD 明記）**。

### タスク4: タブ改称＋4セクションシェル＋ルート scaffold（PR-2 ナビ）
- [x] 完了
- **概要:** BottomNav「戦績」→「統計」（href=`/players`・active 判定に `/tournaments` 追加）。統計配下の
  **均等4分割の下線タブ**シェル（選手検索/大会結果/ランキング/大会統計）を共通コンポーネント化。新規ルートの
  空 scaffold（プレースホルダ）を作り、既存 `/players` 検索をシェル配下に収める。design-spec §3.0。
- **変更対象ファイル:**
  - `apps/web/src/components/layout/bottom-nav.tsx`＋`bottom-nav.test.tsx` — 文言＋active 判定（`/players`|`/tournaments`）
  - `apps/web/src/components/stats/section-tabs.tsx`（新規） — ss-segA 相当の4タブ（現在地でアクティブ）
  - `apps/web/src/app/(app)/players/page.tsx` — シェル配下に収める（検索ロジックは不変）
  - scaffold: `apps/web/src/app/(app)/players/ranking/page.tsx`・`(app)/tournaments/page.tsx`・
    `(app)/tournaments/[id]/page.tsx`・`(app)/tournaments/series/page.tsx`・`(app)/tournaments/series/[id]/page.tsx`・
    `(app)/tournaments/stats/page.tsx`・`(app)/tournaments/stats/[metric]/page.tsx`
  - `apps/web/e2e/` — タブ導線の E2E（4セクション到達＋既存検索の非退行）
- **依存タスク:** なし（PR-1 と並行可）
- **完了条件:** タブ改称の単体テスト green・静的 seg（ranking/series/stats）が `[id]` と衝突しない・
  既存 `/players`/`/players/[id]` 非退行・E2E で4セクション到達。

### タスク5: 選手ランキング クエリ（PR-3）
- [x] 完了
- **概要:** `getPlayerRanking(metric, filter, limit, offset)`。指標＝出場/勝利/勝率(最低20試合)/対戦/
  **優勝(bracket=1)**/**入賞(bracket≤8)**。期間・級フィルタ連動。同値=同順位・値降順→表示名。requirements §3.5/§4.2。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/ranking.ts`（新規）＋共通フィルタ型 `apps/web/src/lib/stats/types.ts`
  - `apps/web/src/lib/stats/ranking.test.ts` — **先にテスト**：各指標・勝率足切り・期間/級絞り・同順位・優勝/入賞は derived_bracket 集計
- **依存タスク:** タスク2（bracket・優勝/入賞のため。数値検証はタスク3後が確実）
- **完了条件:** 全指標のクエリテスト green・期間/級フィルタが効く・drizzle raw の int[] バインドは
  `ANY(ARRAY[...]::int[])`（[[feedback_drizzle_sql_int_array_binding]]）。

### タスク6: 選手ランキング 画面（PR-3）
- [ ] 完了
- **概要:** `/players/ranking`。横スクロール指標チップ＋1行フィルタ（期間/級/絞り込みシート）＋順位リスト
  （TOP100＋もっと見る、行タップ→戦績詳細）。design-spec §3.1。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/ranking/page.tsx`＋クライアント部品（指標チップ/フィルタシート/リスト）
  - `apps/web/src/app/(app)/players/ranking/*.test.tsx` — フロントテスト（指標切替・空状態・長名省略）
- **依存タスク:** タスク4・タスク5
- **完了条件:** フロントテスト green・375px で横スクロールなし（チップ列除く）・同順位表示・空/長大状態。

### タスク7: 大会統計 クエリ（getStatsOverview / getStatsDetail）（PR-4）
- [ ] 完了
- **概要:** `getStatsOverview(filter)`＝絶対数4＋6図（級別構成推移/新規参入者[初出場年・**2011〜**左側打ち切り]/
  一人当たり平均年参加数[**x=級A〜E**]/スコアヒスト25本/年別競技人口/年別大会参加人数）。`getStatsDetail(metric,filter)`＝
  score/competitors/participations の**全級＋各級A〜E**系列。期間フィルタのみ。requirements §3.6/§4.2。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/overview.ts`・`detail.ts`（新規）
  - `apps/web/src/lib/stats/overview.test.ts`・`detail.test.ts` — **先にテスト**：初出場年の2011境界・級別100%積み上げ和=100・一人当たり=年内出場大会数平均・ヒスト25ビン・全級/各級分割
- **依存タスク:** タスク1（competitors/participations/score は bracket 不要だが同 PR 基盤に乗せる）
- **完了条件:** 集計テスト green・event_date 無し大会は期間集計から除外・競技人口=distinct player。

### タスク8: 大会統計 画面（メイン＋図詳細）（PR-4）
- [ ] 完了
- **概要:** `/tournaments/stats`（4カード＋6図・期間フィルタ・完結図は級別構成直下・図4〜6に「級別比較 ›」）＋
  `/tournaments/stats/[metric]`（縦スモールマルチプル・図ごと個別正規化・平均は中立インク破線）。design-spec §3.2/§3.3。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/tournaments/stats/page.tsx`・`[metric]/page.tsx`＋チャート部品（棒/100%積み上げ/ヒスト/スモールマルチプル）
  - 対応 `*.test.tsx` — フロントテスト（図の本数・ドリル導線・期間フィルタ反映・朱不使用）
- **依存タスク:** タスク4・タスク7
- **完了条件:** フロントテスト green・6図/ドリル3図の描画・y目盛＋値ラベル・**朱はデータ装飾に使わない**（平均線/棒は中立or藍）・375px 縦積み。

### タスク9: 大会結果 クエリ（一覧/シリーズ/大会詳細）（PR-5）
- [ ] 完了
- **概要:** `getTournamentList(query?, year?)`（年別）／`getSeriesList()`（大会別＝累計/回次範囲/直近年/状態内訳）／
  `getSeriesDetail(seriesId)`（回次一覧＋参加者数推移）／`getTournamentResults(tournamentId)`（級ブロック→
  {入賞者=bracket集約, クロス表=選手×回戦(勝ち上がり順)}、分割級A1/A2）。requirements §3.4/§4.2。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/tournaments.ts`・`series.ts`・`results.ts`（新規）
  - 各 `*.test.ts` — **先にテスト**：年別セクション化・シリーズ束ね/状態内訳・回次一覧/優勝者/参加者数推移・入賞者導出（優勝/2位/3位同着/4位同着）・クロス表（勝ち上がり順・不戦・相手解決）・分割級A1/A2
- **依存タスク:** タスク2（入賞者=bracket）
- **完了条件:** クエリテスト green・中止/未確定/記録なしの区別・opponent は正規化キー解決（[[impl_tournament_results]] 踏襲）。

### タスク10: 大会一覧（年別/大会別）＋シリーズ詳細 画面（PR-5）
- [ ] 完了
- **概要:** `/tournaments`（年別・年セクション・級トーンドット・参加数・中止朱）↔`/tournaments/series`（大会別・
  シリーズ束ね）のトグル＋大会名検索。`/tournaments/series/[id]`（サマリー帯＋参加者数推移[中止年=朱破線]＋
  回次一覧[新しい順・記録なし帯]）。design-spec §3.4/§3.6。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/tournaments/page.tsx`・`series/page.tsx`・`series/[id]/page.tsx`＋部品（年セクション/系列行/推移チャート）
  - 対応 `*.test.tsx` — 年別↔大会別トグル・中止表示・記録なし帯・空状態
- **依存タスク:** タスク4・タスク9
- **完了条件:** フロントテスト green・トグル切替・級トーンドット（藍→砂）・中止=朱・375px 縦積み。

### タスク11: 大会詳細（入賞者＋級クロス表）画面（PR-5）
- [ ] 完了
- **概要:** `/tournaments/[id]`。タブ＝入賞者 ｜ 級A/B…（分割時 A1/A2・横スクロールピル）。入賞者=優勝/2位/
  3位(同着)/4位(同着) の藍濃淡ピル。級タブ=**クロス表（選手×回戦・勝ち上がり順）**、氏名固定列＋回戦横スクロール、
  敗退後空欄で逆三角形、○=藍/×=中立インク。行タップ→戦績詳細。design-spec §3.5。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/tournaments/[id]/page.tsx`＋部品（ttabs/入賞者ブロック/クロス表グリッド）
  - 対応 `*.test.tsx` — タブ生成（分割A1/A2）・入賞者順位・クロス表の勝ち上がり順/不戦/横スクロール・空/記録なし
  - `apps/web/e2e/` — 大会詳細→戦績詳細の遷移
- **依存タスク:** タスク4・タスク9
- **完了条件:** フロントテスト green・分割級タブ・クロス表の氏名 sticky＋回戦横スクロール（唯一の横スクロール例外）・E2E 遷移・**朱はデータ装飾に使わない**。

## 実装順序 / PR 分割
1. **PR-1 基盤:** タスク1 → 2 → 3（derived_bracket）
2. **PR-2 ナビ:** タスク4（PR-1 と並行可）
3. **PR-3 ランキング:** タスク5 → 6
4. **PR-4 大会統計:** タスク7 → 8
5. **PR-5 大会結果:** タスク9 →（10・11 は並行可）

各 PR は DoD（テスト＋型＋lint＋CI green＋memory 記録）→ prepare-pr → auto-review-loop → ship。
本番 migration 0037 と derived_bracket backfill は PR-1 ship 後に dump/apply（残 DoD 明記）。
