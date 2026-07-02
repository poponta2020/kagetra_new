---
status: completed
---
# stats-grade-population（級別 競技人口サマリー）実装手順書

requirements: `docs/features/stats-grade-population/requirements.md`（completed・design-spec なし＝既存様式踏襲）

## 実装タスク

### タスク1: 級別競技人口の集計（gradePopulation）
- [x] 完了
- **概要:** `StatsOverview` に `gradePopulation: Record<Grade, number>` を追加し、期間内の直近級方式（1人=1級・DISTINCT ON）で集計する `queryGradePopulation(period)` を新設。テストファースト（requirements §4.4 のテスト観点: 昇級 B→A は A のみ／期間で直近級が変わる／grade なしのみは内訳外／同日・日付なしタイブレーク決定的／データなし級は 0）。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/overview.test.ts` — gradePopulation のテスト追加（先に書く）
  - `apps/web/src/lib/stats/overview.ts` — 型拡張＋集計クエリ追加＋`Promise.all` 配線
- **依存タスク:** なし
- **対応Issue:** #257（親 #256）

### タスク2: サマリー「級別 競技人口」カードの追加
- [x] 完了
- **概要:** `/tournaments/stats` の絶対数4カード直下に横長カードを1枚追加。A→E の5列グリッド（級ラベル小＋serif・tabular-nums の人数、4カードより一段小さいサイズ）、注記「期間内で最後に出場した級で1人ずつ数える」、級トーン着色なし、ドリルリンクなし（requirements §3.1）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/tournaments/stats/page.tsx` — page ローカルの級別カードコンポーネント追加＋`ov.gradePopulation` 描画
- **依存タスク:** タスク1
- **対応Issue:** #258（親 #256）

### タスク3: 級別比較ドリルの数え方を1人=1級へ統一
- [x] 完了
- **概要:** `queryCompetitorsDetail` の各級系列を「(選手, 年) ごとの直近級」方式（DISTINCT ON・requirements §4.4 の SQL 方針）へ変更。全級（all）系列は不変。モジュール冒頭 doc の「合算と一致しない理由」を新方式に更新し、`METRIC_ANALYSIS.competitors` の分析文に級別パネルの数え方を追記。テストファースト（同一年内昇級は直近級のみ／年またぎ昇級は各年それぞれ／all 系列不変／既存の級ごと distinct 前提の期待値更新＝仕様変更に伴う更新であることを PR description に明記）。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/detail.test.ts` — 新方式のテスト追加＋既存期待値更新（先に書く）
  - `apps/web/src/lib/stats/detail.ts` — 各級系列クエリ変更＋doc 更新
  - `apps/web/src/app/(app)/tournaments/stats/[metric]/page.tsx` — 分析文追記
- **依存タスク:** なし（タスク1と独立・並行可）
- **対応Issue:** #259（親 #256）

## 実装順序

1. タスク1（依存なし）
2. タスク3（依存なし・タスク1と並行可だが、worktree 1本で逐次なら 1→3 の順）
3. タスク2（タスク1に依存）

備考:
- migration なし・スキーマ変更なし・新規 URL/パラメータなし。
- 1PR=1機能（3タスクまとめて1PR。既存テスト期待値の変更はタスク3の仕様変更由来であることを description に明記）。
- E2E: 画面構造の変更が小さい（カード1枚追加）ため既存 E2E への影響なし想定。Playwright 追加は不要（統計画面の既存 E2E 慣行に合わせる）。
