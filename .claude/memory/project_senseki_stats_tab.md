---
name: project_senseki_stats_tab
description: 戦績→「統計」タブ再編(4セクション)。design-spec locked＋requirements completed、収束ゲート達成、実装計画待ち
metadata: 
  node_type: memory
  type: project
  originSessionId: 31a3c1ab-ea8b-4681-9be8-e27a91a10a02
---

戦績タブを「統計」に改称し **4セクション**（①選手検索 ②大会結果 ③選手ランキング ④大会統計）へ再編する機能。収録済み全国データ（1,496大会/819,703対戦/47,709人/367,675参加/180系列）を「個別に引く（閲覧）／横断集計（統計）」の2軸で見せる。

**状態（2026-07-01）:** design/requirements/plan 全 completed＝収束ゲート達成。親 #208＋子 #209-219（11タスク/5PR）。**PR-1〜3 SHIPPED**（PR#220 基盤 [[impl_senseki_stats_pr1_derived_bracket]]／PR#221 ナビ [[impl_senseki_stats_pr2_nav]]／**PR#222 ランキング [[impl_senseki_stats_pr3_ranking]]**）。**残＝PR-4 大会統計（#215 query getStatsOverview/getStatsDetail／#216 画面）→ PR-5 大会結果（#217-219）**。次＝`/implement senseki-stats`（タスク7 から・依存＝タスク1 済）。

**確定モック**（Claude Design "Kagetra Design System"・projectId `74ab8bf1-f11a-48e8-9853-e063b2f1f2d5`・`preview/`）: senseki-stats-a（シェル+ランキング）／-main（大会統計サマリー6図）／-detail（図詳細・級別比較）／-tournaments（一覧年別）／-tournaments-series（一覧大会別）／-tournament-detail（入賞者）／-tournament-detail-class（級=クロス表）／-tournament-series-detail（シリーズ詳細）。不採用 b/agg/overview は削除済。共有CSS=`preview/_senseki-stats.css`。

**非自明な確定:**
- 大会詳細の級タブ＝旧サイトの**クロス表（選手×回戦）を復元**（氏名固定列＋回戦だけ横スクロール、敗退後セル空欄で勝ち残りが**逆三角形**に見える＝一目で分かる特性をユーザーが重視）。初期の「選手ごと経路チップ」案はユーザー指摘で**破棄→クロス表へ差し戻し**。○＝藍／×＝中立インク（**朱はデータ装飾に使わない**＝中止/締切/拒否のみ）。決勝進出者は全経路実データ、途中敗退者は敗退対戦＋勝ち上がり○のみ（相手不明は捏造しない）。
- 大会一覧＝**年別／大会別トグル**の2ビュー（大会別＝シリーズ束ね）。大会統計＝メイン全体サマリー（絶対数4カード＋6図：級別構成推移／新規参入者[初出場年・**2011〜**左側打ち切り]／一人当たり平均年参加数[**x=級A〜E**]／スコアヒスト／年別競技人口／年別参加人数）＋図詳細（4〜6のみ級別比較スモールマルチプル・図ごと個別正規化）。
- 統計の共通基盤＝`tournament_participants.derived_bracket smallint`（materialize時にlib/players/placementでprecompute＋367,675行backfill）。優勝/入賞ランキング・入賞者順位・級タブ最終成績の単一ソース。
- **①選手検索は既存 [[project_senseki_detail_redesign]]（/players 検索＋戦績詳細）を流用**＝新規UIなし・導線接続のみ。
- ルート据え置き/新設：`/players`・`/players/[id]` 据え置き、`/players/ranking`・`/tournaments`(+`/[id]`)・`/tournaments/series`(+`/[id]`)・`/tournaments/stats`(+`/<metric>`) 新設。
- PR分割（requirements §8 / Issues）＝**PR1基盤**(derived_bracket: #209 schema+migration0037／#210 materialize配線／#211 全件backfill)／**PR2ナビ**(#212 タブ改称+4セクションシェル+ルートscaffold)／**PR3ランキング**(#213 query／#214 画面)／**PR4大会統計**(#215 query／#216 画面)／**PR5大会結果**(#217 query／#218 一覧+シリーズ詳細／#219 大会詳細)。next migration=**0037**(head=0036)。
