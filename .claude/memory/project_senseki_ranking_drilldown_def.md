---
name: project_senseki_ranking_drilldown_def
description: "ランキング→選手詳細ドリルダウン絞り込みの機能定義（親#236+子#237-239・実装完了→[[impl_senseki_ranking_drilldown]]）"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5524f5fd-ac53-41c2-a51f-169d538d430d
---

**senseki-ranking-drilldown 機能定義完了（2026-07-02）・実装 SHIPPED → [[impl_senseki_ranking_drilldown]]（PR#242 merge 82437b6）。**

ランキング（[[impl_senseki_stats_pr3_ranking]]）の選手名タップで遷移した選手詳細 /players/[id]
（[[project_senseki_detail_redesign]]）に遷移元フィルタを適用する。

**主要な設計判断:**
- URL は PR#230 ④で複写済みのランキング params（from=ranking&metric&f&yearFrom&yearTo&grades）を
  **詳細側が読むだけ**＝新パラメータ発明なし・組み立て側変更ゼロ。非明示（f無し）は詳細側でも
  parseRankingParams 再利用で同じデフォルト（A級・直近5年）を注入し母集合を厳密一致。
- ①全指標: 期間+級で participations を絞る（条件式は ranking.ts filterConds とセマンティクス一致）。
  ②優勝/入賞のみ: 一覧をさらに derived_bracket=1 / <=8 で絞る（ランキングと単一定義
  [[impl_senseki_stats_pr1_derived_bracket]]・final_rank フォールバック優勝は出ない割り切り）。
- **ヘッダ集計は①母集合で再計算**（②でも bracket 絞りはヘッダに掛けない）＋
  「2021〜2026年・A級大会での成績」形式の条件表示行（ユーザー確定の要望）。
  **受け入れ基準=ランキング指標値とヘッダ対応値の一致**（6指標、整合テスト必須）。
- identity（氏名・現級・所属）は全成績ベース維持（フィルタ非依存・別軽量クエリ）。
- 解除導線=現URL+`all=1`（params 維持→「← ランキングへ戻る」が生きる）。
- 相手名タップは引き継がない・折り畳み初期状態不変・includeFormer/minMatches は詳細絞りに不使用。
- design_required: false（既存語彙内 delta・ユーザー確認済み）。DB変更/migration なし。

**Issue:** 親 #236 + 子 #237（getPlayerRecord 拡張=opts{filter,bracketAtMost}・id先絞り→inArray方式）/
#238（scopeLabel 純関数=文言+解除href+bracket変換）/ #239（page.tsx 配線）。1PR・順序 1→2→3。

**並行注意:** [[project_senseki_stats_refinements]]（定義済み・実装待ち）と ranking.ts/metrics.ts が
近接。同時実装せず直列（機能的干渉なし）。

成果物: docs/features/senseki-ranking-drilldown/{requirements,implementation-plan}.md（両方 completed）
