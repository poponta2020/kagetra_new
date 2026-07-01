---
name: impl_senseki_stats_pr5_tournament_results
description: "senseki-stats PR-5 大会結果（一覧/大会別/大会詳細/シリーズ詳細）SHIPPED。5PR完了で親#208クローズ可"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1164f936-96ec-4e30-8903-b333fb52f5c1
---

senseki-stats 最終 PR-5「大会結果」SHIPPED（[[project_senseki_stats_tab]] の PR-5・#217/#218/#219）。**PR#229 merge `dc04d6a`（2026-07-01・/implement→auto-review-loop→ship 自律完走）**。migration 追加なし（derived_bracket は PR-1 の 0037 で既出）。

**クエリ（`apps/web/src/lib/stats/`）:**
- `results.ts` `getTournamentResults(id)` = 級ブロックごとに {入賞者=derived_bracket集約（優勝1/2位2/3位4/4位8・非導出級は final_rank フォールバック）, クロス表=選手×回戦（勝ち上がり順=到達回戦降順→最終勝敗→bracket→名前・敗退後空セル＝逆三角形）}。同一級の複数 tournament_classes は A1/A2 ラベル。順位定義は戦績詳細 `buildWinners`/`derivePlacement` と単一ソース。
- `series.ts` `getSeriesList(query?)`（大会別台帳＝累計開催回数[held]/回次範囲/直近年/状態内訳）＋`getSeriesDetail(id)`（回次一覧+優勝者+参加者数推移）。
- `tournaments.ts` `getTournamentList(query?,year?,limit,offset)`（年別・級構成/参加者数/検索/年/ページング）。

**画面:** `/tournaments`(年別・年セクション+級トーンドット)↔`/tournaments/series`(大会別)トグル+大会名検索共通／`/tournaments/series/[id]`(サマリー帯+参加者数推移[中止=朱破線]+回次一覧)／`/tournaments/[id]`(ttabs 入賞者｜級A/A1/A2…+クロス表 氏名sticky+回戦横スクロール)。新規部品 GradeDots/ParticipantTrendChart(純SVG)/TournamentsHeader/TournamentYearList/TournamentDetailTabs＋loadMoreTournaments Action。

**非自明（Codex 5R で確定）:**
- enum配列は node-pg にパーサ無く生文字列返り→`::text[]` キャストで JS 配列化（[[feedback_pg_enum_array_text_cast]] 候補）。
- 大会別「累計開催回数」= **held 件数**。editions 0件系列は LEFT JOIN の NULL 拡張行を生むが `count(e.id) FILTER (WHERE status=...)` で確実除外（`count(*)` 不可）。シリーズ詳細の通算開催回数と一致。
- シリーズ優勝者は大会詳細と単一ソース＝bracket=1 優先・非導出級は final_rank『優勝』(準優勝除外)・級順A→Eで最上位級（下位級 bracket=1 で上書きしない）。SQL は `DISTINCT ON (edition) ... ORDER BY 級順, (bracket=1優先), tc.id`。
- 動的ID は `/^\d+$/` + int4上限(≤2147483647)で 1.0/1e3/超過の 500 を回避。LIKE検索は `ESCAPE '\'` 明示（%/_ を server 設定非依存で literal）。
- クロス表は行 onClick(useRouter)+氏名Link 併用（キーボード/SR=Link・タッチ=行全体タップ）。行 tabIndex 追加は二重タブストップで逆効果＝しない。

**R5 override:** Codex R5 の blocker「`matches` import が存在しない export（tournamentMatches では）」は**誤検出**（schema index.ts で `export * from './matches'`・`tournamentMatches` は不在・tsc 5R連続0エラー）／should_fix「クロス表キーボード」は氏名Linkで既に充足。CI green で override ship（PR#192 accessibility override と同型 [[reference_tool_output_fabrication]] とは別＝モデル誤読）。

**検証:** 全 web 963+ tests green（新規 results6/series9/tournaments7/GradeDots2/ParticipantTrendChart2/TournamentsHeader4/TournamentYearList6/TournamentDetailTabs5＋E2E2）・tsc0・lint clean。isolated test DB `kagetra_test_pr5`(5434) 使用（並行 worktree の共有DB push 競合回避＝[[feedback_shared_test_db_worktree_push_race]]・ship時drop）。

**残 DoD:** 本番実機目視（375px・クロス表の氏名sticky+回戦横スクロール・大規模級の性能・年別/大会別トグル・中止破線）。**senseki-stats 全5PR 完了＝親 #208 クローズ**。⚠️シリーズ/大会別の中身は本番 tournaments↔editions 紐付け（edition_null 22 のみ＝ほぼ紐付け済み・[[project_tournament_series_master]]）に依存。
