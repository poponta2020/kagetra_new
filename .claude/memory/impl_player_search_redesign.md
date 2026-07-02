---
name: impl_player_search_redesign
description: "選手検索結果を密なリスト化＋現級/最終出場表示＋ヘッダ固定 SHIPPED (PR#241)"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb3d5802-ba78-4e85-85dc-4bb4748429a2
---

選手検索（`/players`）結果一覧を密なリスト（方向性A）へリデザイン。design-spec `player-search-redesign`（locked・define-feature は回さず spec を要件成果物に）。**PR#241 merge `ddd5ded`(2026-07-02・implement→auto-review 4R→ship 自律完走)**。GitHub Issue なし（spec 駆動）。migration なし（既存 `derived_bracket` 列を再利用）。

非自明:
- **lastResult は再導出せず保存済み `derived_bracket`→`labelForBracket`（優勝/準優勝/ベストN）→ 生 final_rank → null(記録なし)**。詳細画面 `rank` と単一ソース（保存値==rankBracket の不変条件は queries.test 済）＝N+1 回避。`labelForBracket` を placement.ts から export。
- **直近参加 1 件を `leftJoinLateral` で一括取得**（affiliation/event_date/name/derived_bracket/final_rank を同一行から＝列ごとに直近判定がズレない）。現級だけは条件が違う（**非 null grade の直近**＝絶対的直近が grade null でも遡る）ので別の相関サブクエリ。drizzle 0.45 は leftJoinLateral 対応。
- **並び順**: `lastEventDate 降順 NULLS LAST` 主キー（現役が上・開催日不明は常に最後尾）。第2/3キー `participationCount 降順→displayName` は「lastEventDate が等しい行同士＝同日/null 群の中」でのみ効く（null 行が出場数で日付あり行を追い越さない）。design-spec §6。
- **引退ミュート閾値＝10年（ユーザー確定・モック準拠）**: `year <= nowYear - 10`＝境界の10年前ちょうども含む（2026基準で2016以前ミュート・2019/2021通常）。nowYear は page で1度算出し全行へ渡す。開催日不明も薄く表示。
- **SectionTabs 固定は統計4画面共通の共有変更**（`sticky top-0 z-20`）。タブ高さを AppBar と同じ 44px(h-11)に正規化＝検索バー固定 `top-11` を確定オフセット化。検索バーは surface+下境界+淡い影で `sticky top-11 z-10`（選手検索のみ）。AppBar は `<main>` の外なので top-0=タブがAppBar直下。
- **Codex auto-review 4R で pass**（effort=high 固定・>400行）。R1-3 はいずれも挙動非変更（並び順コメント/ミュート境界文言の明確化・出場数テストを親要素単位に堅牢化）、R4 pass。累計~181k tokens。CI green。
- テストハーネスの罠は [[reference_worktree_vitest_db_setup]]（Node24 localhost→IPv6 ECONNRESET・worktree .env コピー・隔離DB）。

残 DoD=本番実機目視（スクロール時タブ+検索バー固定・ボタン浮かない・4画面の固定リグレッション・横スクロールなし）。web 再ビルドで反映（migration 無＝auto-deploy の DB ステップ対象外）。関連: [[project_senseki_stats_tab.md]] の①選手検索タブ。
