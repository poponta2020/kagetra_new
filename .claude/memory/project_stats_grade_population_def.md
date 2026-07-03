---
name: project-stats-grade-population-def
description: "大会統計サマリーに級別競技人口カード追加＋既存級別グラフを1人=1級方式へ統一する機能定義（親#256+子#257-259）"
metadata: 
  node_type: memory
  type: project
  originSessionId: 847b4ceb-7384-4328-8331-aa04b27604f8
---

# stats-grade-population 機能定義（2026-07-03・実装未着手）

親 #256＋子 #257（gradePopulation 集計）/#258（サマリーカード）/#259（ドリル統一）。requirements/implementation-plan = `docs/features/stats-grade-population/`（両方 completed）。migration なし・design-spec なし（既存 StatCard/ChartCard 様式踏襲をユーザー確認）。

主要設計判断（すべてユーザー選択 2026-07-03）:
- **直近級方式（1人=1級）**: 期間内の A〜E 級参加のうち「最後に出場した級」に1人だけカウント。級ごと distinct 案は不採用。
- タイブレークは選手検索の直近所属（PR#194）と同流儀: `event_date` 降順 NULLS LAST → 同日 `tournaments.id` 降順 → 同大会内 grade 昇順。
- **A〜E のみ表示**: grade なしクラス（名人・クイーン戦/F級）のみ出場の選手は内訳外 → A〜E 合計 ≦ 全体競技人口（合計一致は要件でない）。
- **既存ドリル（/tournaments/stats/competitors）の各級系列も同方式へ統一**（追加要望）: 年別グラフでは「各年の中」で直近級を決める（期間全体の直近級で過去年を塗り替えると歴史が歪む）。all 系列は不変。既存 detail テストの期待値更新は仕様変更由来として PR に明記する。
- SQL は DISTINCT ON パターン（[[impl_senseki_ranking_refinements]] の現級母集団と同型）。

実装順序: #257 → #259（独立・並行可）→ #258。1PR=3タスク。実装完了時は本 memory を SHIPPED 版に更新。
