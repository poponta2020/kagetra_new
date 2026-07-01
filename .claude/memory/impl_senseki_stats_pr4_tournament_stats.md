---
name: impl_senseki_stats_pr4_tournament_stats
description: senseki-stats PR-4 大会統計（getStatsOverview/Detail クエリ＋メイン/図詳細 画面）SHIPPED PR#223
metadata: 
  node_type: memory
  type: project
  originSessionId: 0d6e2836-803b-4d21-9ab8-b2e6692e2982
---

senseki-stats PR-4「大会統計」タスク7（クエリ）＋タスク8（画面）**SHIPPED**。PR#223 merge `0faed90`（2026-07-01・自律 /implement→prepare-pr→auto-review-loop→ship 完走）。子 #215/#216 クローズ。migration 無し（derived_bracket は PR-1 の 0037 で既出）。Codex 3R 収束（R1 detail redirect・R2 総対戦数→実試合数・R3 pass）・CI green。親 [[project_senseki_stats_tab]] の残り＝PR-5（大会結果 #217-219）。

**タスク7 クエリ**（commit e70676d, Fixes #215）:
- `apps/web/src/lib/stats/overview.ts` getStatsOverview＝絶対数4＋6図（級別構成推移/新規参入者[2011〜]/一人当たり平均年参加数[x=級]/スコアヒスト25本+平均/年別競技人口/年別大会参加人数）。期間フィルタのみ・級では絞らない。
- `detail.ts` getStatsDetail(score/competitors/participations)＝全級＋各級A〜E 系列。
- `filters.ts` periodConds（期間のみ・生SQL用 AND連結）／types.ts に DetailMetric+coerceDetailMetric。
- 非自明: **新規参入者の初出場年は全データで min(year) 確定→期間は表示窓のみ絞る**（部分集合内の「新規」ではない）。**全級(all)は per-grade の単純合算でない**＝competitors は distinct player（重複排除）・participations は grade null 級も含む（各級和より多い）→ all は別クエリ/別集計。スコアヒストは normal の**勝者行のみ**で試合1回カウント（勝敗2行の二重計上回避）。db.execute は count を `::int`/`::float8` にキャストして JS number 化。

**タスク8 画面**（commit 5310be8, Fixes #216）:
- `/tournaments/stats`（メイン4カード＋6図・図4〜6に「級別比較 ›」ドリル）＋`/tournaments/stats/[metric]`（全級＋A〜E 縦スモールマルチプル・図ごと個別正規化）。
- 純SVGチャート `components/stats/charts/`（BarChart/Histogram/StackedComposition＝y目盛+値ラベル・フックなし＝サーバー描画/jsdomテスト可）。`chart-utils.ts`（niceMax/axisTicks/formatCompact[万]/denseYears）。`grade-tones.ts`（A藍→E砂トーンランプ・**朱はデータ装飾に使わない**・平均線=中立インク破線）。`StatsPeriodFilter.tsx`（期間のみ・basePath 受けでメイン/詳細共用）。
- 非自明: **値ラベルと y/x 目盛のテキスト衝突**でテストが getByText 多重ヒット→値ラベルは `text.font-display` で絞る・軸と非衝突の目盛だけ検証。SVG `<text>` の `平均 {x}` は2テキストノードに割れる→**テンプレ文字列で単一ノード化**。jest-dom 未設定なので `.toBeTruthy()`/`querySelectorAll` で検証（既存 RankingFilterBar 踏襲）。E2E senseki-stats-nav は旧 scaffold h1「大会統計」撤去に追随（級別構成の推移 見出し＋active tab で検証）。
- テスト: stats+ranking 全111 green・typecheck・lint green。TEST_DATABASE_URL=kagetra_test_tstats で隔離（並行 import-past-results worktree と共有DB衝突回避）。

Codex レビューでの確定判断: **総対戦数カード＝実試合数（normal 勝者行のみ・約半分）をユーザーが選択**（corpus 見出し 819,703=行数 ではなく試合数。スコアヒストと定義一致）。残＝**本番実機目視のみ**（auto-deploy で反映済み）。
