---
name: impl_stats_pareto_rename
description: "大会統計 図4「スコア統計」→「枚数差統計」改称＋パレート図化＋級別比較分析文 SHIPPED (PR#255)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2046e72-00c9-4dc7-8f25-74307a83c2fc
---

大会統計タブの delta 改修3点。PR#255 merge `4ec4643`（2026-07-03）・GitHub Issue なし（quickfix）・migration 無。Codex 1R（medium）pass・CI green。

- ①図4とその図詳細のタイトルを「スコア統計」→「枚数差統計」に改称。URL キー `score`（/tournaments/stats/score）は据え置き＝既存リンク非破壊、表示名のみ変更（params.ts の DETAIL_METRICS）
- ②級別比較ページの METRIC_ANALYSIS.score に分析文を追加（運命戦最多／E→B で平均枚数差減少＝実力差縮小／B→A は+0.4枚＝A級昇級なしで差異が生じやすい／実力差最大E級・最小B級）。ユーザー指定文言そのまま
- ③Histogram をパレート図化: 累積%折れ線＋**右側第二軸（0〜100%固定・0/25/50/75/100目盛）**。棒は枚数差1→25の順序維持（ユーザー承認。運命戦=1枚差が最頻でほぼ降順＝実質パレート順。頻度降順ソートは平均線とx軸可読性を壊すため不採用）。累積線は中立インク実線＝破線の平均線と区別（朱不使用ルール遵守）。total=0 は折れ線非描画（NaN回避）。メイン図4と級別比較全パネルの両方に反映（コンポーネント共用）

**非自明:** ローカル Windows の `next build` は standalone output の symlink 作成で EPERM 失敗する（コンパイル自体は成功・権限の環境問題・CI の Linux build で最終確認する運用）。関連 [[impl_senseki_stats_pr4_tournament_stats]] [[impl_stats_chart_yaxis_labels_fix]]

残=本番実機目視（/tournaments/stats と /tournaments/stats/score）
