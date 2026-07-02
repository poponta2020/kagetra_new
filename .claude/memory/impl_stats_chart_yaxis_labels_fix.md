---
name: impl_stats_chart_yaxis_labels_fix
description: "大会統計グラフの棒上値ラベル削除＋縦軸目盛バグ(小数/重複)修正 SHIPPED PR#243"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b675fd3-6a65-4fd4-80c8-5389c9405ad3
---

大会統計画面（[[project_senseki_stats_tab]] の④）のグラフ 2 点修正。**PR#243 merge `2c1f4a4`(2026-07-02・quickfix→auto-review-loop→ship 自律完走)・migration 無・Codex 1R(medium) pass**。

- **棒上の値ラベル削除**: `BarChart.tsx` の各棒の上に出る数値（値ラベル）を撤去し y 目盛で読む方式に（オーナー指示・モバイル図の煩雑さ回避）。design-spec §3.2「棒に値ラベル」記述も更新。ヒストグラム(図4)の「平均 N.N」線ラベルは残す。
- **縦軸目盛バグ修正**: `chart-utils.ts` の `niceMax`/`axisTicks` を書き換え。旧実装＝上端を等分方式で、上端が **1** → `0/0.25/0.5/0.75/1`→整数丸めで **「0,0,1,1,1」** 重複、上端 **2.5** → **「0,1,1,2,3」** 破綻していた。新実装＝**きり良いステップ(1/2/5×10ⁿ)で 0 から刻む**＋`integer` 引数。件数軸(Histogram/ParticipantTrend/全値整数の BarChart)は `integer=true` で整数目盛保証、小数軸(一人当たり平均)は 0/0.5/1.0… の割り切れる目盛。

**非自明**: 共有 util を変えたので、別画面(シリーズ詳細)の `ParticipantTrendChart` も件数軸→`integer=true` を渡さないと小数目盛(0.5刻み)に退行する＝スコープ外だが巻き込み修正必須。`BarChart` は `data.every(Number.isInteger)` で整数軸を自動判定。CI 初回 fail は `new-member-form` のフォームリセット非同期レース(1/1058・chart 無関係)＝`gh run rerun --failed` で green。残＝本番実機目視(web 再ビルドで反映)。
