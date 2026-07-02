---
name: project_senseki_stats_refinements_def
description: "統計画面 delta 改修4件の機能定義（親#231+子#232-235）— クロス表左端寄せ/大会一覧通称表示(short_name新設)/現級フィルタ優勝者除外/勝率最低試合数可変"
metadata: 
  node_type: memory
  type: project
  originSessionId: beb8c5cf-0e5d-47a3-8389-f27bf7424277
---

# senseki-stats-refinements 機能定義（2026-07-02・実装未着手）

[[project_senseki_stats_tab]] / [[project_senseki_ranking_refinements_def]] への続編 delta 改修4件。
要件=`docs/features/senseki-stats-refinements/requirements.md`・手順書=`implementation-plan.md`（両方 completed・design-spec なし＝既存デザイン語彙内の小差分でユーザー確認済み省略）。親Issue #231＋子 #232-235。1PR・4タスク（①→②→③→④、③④は ranking.ts/RankingFilterBar 共有で直列）。

主要な設計判断:
- **① クロス表左端寄せ** (#232): 大会詳細級タブ（唯一のstickyテーブル）。ラッパー `-mx-4 px-4` の左paddingを外しセル側 pl-4 に移す。
- **② 通称表示** (#233): **DBに略称は無かった**（series.aliases は名寄せ用）。`tournament_series.short_name`(nullable) 新設＋**180件バックフィルを migration に UPDATE 同梱**（name キー・冪等・auto-deployで残DoDゼロ化）。表示=「略称+開催級連結」（大阪BC）・年別一覧のみ・未紐付き22/1496件と未設定は正式名称フォールバック・検索は t.name のまま・GradeDots併存。**略称180件は実装タスク内で案生成→short-names.md でユーザーレビュー承認→migration確定**。edition紐付き率98.5%（ローカル実測）が方式選定の根拠。
- **③ 現級フィルタ優勝者除外** (#234): B-E級優勝=必ず昇段（ドメインルール）。currentGradeMembership の直近判明級参加そのものが derived_bracket=1 かつ級B-E→母集団除外。A級対象外・トグルONは現行どおり。優勝定義は優勝回数ランキングと単一（derived_bracket=1・final_rankフォールバックしない＝導出不能級の優勝は除外不能を許容）。
- **④ 勝率最低試合数** (#235): StatsFilter.minMatches（勝率のみ使用・1-1000クランプ）追加。プリセットチップ 5/10/20/50/100・デフォルト20維持・URLは20以外のみ付与（明示フラグと独立）・指標切替で保持し他指標は無視。

実装は /implement 指示待ち。migration 番号は実装時に journal 確認で採番。
