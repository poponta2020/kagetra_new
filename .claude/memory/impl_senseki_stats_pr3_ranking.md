---
name: impl_senseki_stats_pr3_ranking
description: senseki-stats PR-3（選手ランキング）SHIPPED。getPlayerRanking 6指標＋/players/ranking 画面。PR#222 merge
metadata:
  node_type: memory
  type: project
  originSessionId: 420e2ddf-1ce0-4c99-a3b8-c3f57ba72fc9
---

senseki-stats タスク5+6（#213/#214・PR-3 ランキング）**SHIPPED**。**PR#222 merge `0d6fe10`（2026-07-01・/implement→auto-review-loop→ship 自律完走）**。子 #213/#214 クローズ、親 #208 は OPEN 継続（PR-4/5 残）。worktree クリーンアップ済。

**やったこと:**
- **`getPlayerRanking(metric, filter, limit, offset)`**（`apps/web/src/lib/stats/ranking.ts` 新規）＝6指標: 出場/勝利(normal win)/勝率(最低20試合足切り)/対戦(normal)/優勝(derived_bracket=1)/入賞(derived_bracket≤8)。期間(年 from–to)・級(A–E)フィルタ連動。集計サブクエリ＋`rank() over(order by value desc)`（競技ランキング=タイの次は飛ばす）＋`count(*) over()`（該当総数）＋相関サブクエリ（直近所属＝searchPlayers と同一）を1クエリで。並びは値降順→表示名→player_id（offset ページング安定化）。
- 共通フィルタ型＋検証を **`lib/stats/types.ts`**（db 非依存）に集約: `StatsFilter`/`RankingMetric`/`coerceRankingMetric`/`sanitizeStatsFilter`。
- **`/players/ranking` 画面**（`app/(app)/players/ranking/*`）＝横スクロール指標チップ（Link・現フィルタ保持）＋1行フィルタ（期間/級・絞り込みボトムシート）＋順位リスト（行タップ→戦績詳細・TOP100＋もっと見る=Server Action `loadMoreRanking`）。metrics.ts=指標カタログ/URL 組立/searchParams 検証。
- テスト: ranking(DB) 13 / types 8 / metrics 13 / チップ 2 / フィルタ 5 / リスト 8。

**非自明ポイント（Codex 6R で収束・全 blocker 実欠陥）:**
- **入力検証は data-access の単一 choke point `getPlayerRanking` に集約**（page/Server Action 両方が通る）。信頼できない入力（改変 metric→`aggFor` が undefined で例外／enum外 grade・NaN年・負 offset で DB エラー→500）を coerce/sanitize/clamp で丸める。Server Action 側は重ねて検証しない（R1 blocker）。
- 未認証 Server Action は空配列でなく **`redirect('/auth/signin')`**（空配列だと「もっと見る」が rows.length<total で消えず失敗ループ・R2 blocker）。
- `total` は `count(*) over()` だが offset 末尾超えで rows 空だと 0 → 契約（offset 非依存）維持のため **rows 空時のみ agg を数え直すフォールバック**（R2 should_fix）。
- RankingList: 追加取得が空配列なら **exhausted で終端**（R3）・reject は **try/catch でエラー表示＋再試行**＋多重実行ガード（R4 blocker）。
- **Next.js searchParams は `string | string[]`**（`?grades=A&grades=B`）。`.split` が配列で TypeError→500 だった。parseRankingParams で先頭採用＋flatMap 平坦化、page.tsx の型も `Record<string,string|string[]|undefined>` に是正（R5 blocker=実バグ）。
- **RankingMetric 型を ranking.ts→types.ts へ移設**し ranking.ts で再エクスポート（クライアントは metrics.ts 経由で db を持ち込まない・型は import type で erase）。
- **CI 落ち2件を修正**: ①PR-2 の E2E `senseki-stats-nav` が旧 scaffold h1「選手ランキング」を assert→本実装で撤去したため fail。指標 tablist(role=tablist aria-label=指標)可視＋ランキングタブ active に追従（`8e2d2c8`）。②無関係 flaky `admin/members/new-member-form`（フォームリセット競合・初回CIは通過）→ `gh run rerun --failed` で green。

**残:** 本番実機目視（375px 縦積み・横スクロールは指標チップのみ・もっと見る・絞り込みシート）。**次＝PR-4 大会統計（#215 query／#216 画面）**。親=[[project_senseki_stats_tab]]、基盤=[[impl_senseki_stats_pr1_derived_bracket]]、ナビ=[[impl_senseki_stats_pr2_nav]]、所属=[[impl_player_search_recent_affiliation]]。
