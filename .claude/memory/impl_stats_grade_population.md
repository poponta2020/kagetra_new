---
name: impl_stats_grade_population
description: 級別競技人口サマリー SHIPPED(PR#261 merge 76f88de)。1人=1級・直近級方式のDISTINCT ON集計＋カード＋ドリル統一。親#256+子#257-259全クローズ
metadata: 
  node_type: memory
  type: project
  originSessionId: 30bfe8a1-0f7f-4f4d-8a5a-00a16d1c343a
---

# stats-grade-population SHIPPED（PR#261 merge `76f88de`・2026-07-03）

親#256＋子#257-259 **全クローズ**。要件=[[project_stats_grade_population_def]]。migration/スキーマ/URL変更なし。Codex 1R(high) pass・CI green。残=本番実機目視。

- **#257 集計** `035e9e0`: `StatsOverview.gradePopulation: Record<Grade, number>` 新設。`queryGradePopulation(period)`＝`DISTINCT ON (tp.player_id)`＋`ORDER BY player_id, event_date DESC NULLS LAST, t.id DESC, grade ASC`（grade enum は A→E 定義順なので ASC=上位級）。
- **#259 ドリル統一** `2d59906`: `queryCompetitorsDetail` 各級系列を `DISTINCT ON (player_id, extract(year FROM event_date))` の年内直近級へ変更。all 系列は不変。`METRIC_ANALYSIS.competitors` に数え方追記。既存テスト1本の期待値更新（同一大会複数級 X が B にも立っていた→A のみ）。
- **#258 カード** `404303a`: 4カード直下に GradePopulationCard（5列グリッド・serif text-xl・級トーンなし・注記「期間内で最後に出場した級で1人ずつ数える（単位：人）」）。機能定義 docs 同梱（メイン側で未コミットだったため worktree へコピーして初コミット）。

## 非自明な点
- **turbo strict env が TEST_DATABASE_URL を落とす**: ルート `pnpm test`（turbo）だと mail-worker が localhost フォールバック→IPv6 ECONNRESET で即死。`pnpm --filter <pkg> test` で直接実行すれば通る（turbo.json に env 宣言なし）。
- 隔離 test DB=`kagetra_test_sgp`（kagetra_test の schema-only dump から複製・127.0.0.1:5434）。
- テスト結果: web 1112 pass / mail-worker 401 pass / shared 19 pass・check-types/lint green。

worktree=`C:/tmp/impl-stats-grade-population`・branch=`feature/stats-grade-population`。残=PR作成→auto-review-loop→ship→本番実機目視。
