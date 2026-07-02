---
name: impl_senseki_stats_refinements
description: "統計 delta 改修4件(クロス表左端/通称表示/現級優勝者除外/勝率最低試合数)SHIPPED PR#240"
metadata: 
  node_type: memory
  type: project
  originSessionId: a304bc14-aef1-40ad-b9e2-74683db0f9a8
---

統計タブ delta 改修4件 **SHIPPED**。PR#240 merge `6e8c2a3`(2026-07-02・/implement→auto-review-loop→/ship 自律完走)。親#231＋子#232-235 全クローズ・migration 0038。定義は [[project_senseki_stats_refinements_def]]。

**4改修:**
- **① クロス表フルブリード**（TournamentDetailTabs）: スクロールラッパー `-mx-4 overflow-x-auto px-4`→`pr-4`（左padding除去・右終端padding維持）＋sticky選手セル(thead/tbody th)を `px-2`→`pl-4 pr-2`。
- **② 通称表示**（年別一覧のみ）: `tournament_series.short_name`(nullable)新設＋承認済み180件を migration 0038 で投入。getTournamentList に series JOIN、`tournamentDisplayTitle` で「通称＋開催級(A→E)」合成（例 大阪BC／級なしは通称のみ／null は正式名称フォールバック）。検索・大会詳細・シリーズ・選手詳細は正式名称のまま。
- **③ 現級から直近優勝者除外**（ranking.ts currentGradeMembership）: DISTINCT ON に `derived_bracket` 追加、外側 WHERE で「直近参加そのもので優勝した B〜E級」を除外（A級対象外・トグルON現行どおり）。
- **④ 勝率 最低試合数可変**: `StatsFilter.minMatches`(勝率のみ・1〜1000クランプ)、絞り込みシートに勝率タブ限定チップ 5/10/20/50/100(既定20)。URL は20以外のみ `minMatches=` 付与し明示フラグ `f` と**独立**（非明示ビューでも保持）。

**非自明:**
- 略称180件は私が案生成→`short-names.md`→**ユーザーがレビュー修正して承認**（1=光ルくん杯/21=選抜/101=女流/177-180=名人戦東/クイーン選東 予選 等）。migration は生成後に `ADD COLUMN IF NOT EXISTS`＋180 UPDATE(name一意キー・breakpoint区切り)を手で追記。実データコピー(kagetra_rehearsal→scratch)へ適用し **180/180 付与・0 missing** 検証済。
- ③ 計画の平文 SQL `NOT(grade IN(B..E) AND derived_bracket=1)` は derived_bracket=null で `NOT(true AND null)=null` となり **null級の非優勝者まで母集団から落ちる**バグ。`coalesce(cur.derived_bracket=1, false)` で回避（Codex も評価）。ブラケット導出不能の優勝は除外しない割り切りと整合。
- ④ 既定20とプリセットは db 非依存の types.ts に集約(`DEFAULT_WIN_RATE_MIN_MATCHES`/`WIN_RATE_MIN_MATCHES_PRESETS`)し ranking/metrics/UI で共有。buildRankingHref は explicit ブロック外で minMatches 付与→RankingMetricChips 経由の指標切替でも保持。
- getTournamentList は t.id で GROUP するため JOIN した `s.short_name` を GROUP BY に明示追加（関数従属が s まで及ばない）。
- **ユーザー指示で ② を後回し**にし ①③④ を先に auto-review-loop 収束(1R pass)→②承認後に実装→全PR再レビュー(1R pass)→ship。Codex 2パス計 ~188k tokens・全 pass 指摘0。
- テスト隔離 DB は `kagetra_test_ssr`（[[feedback_windows_localhost_econnreset_docker_pg]] / [[feedback_shared_test_db_worktree_push_race]]）。

**残 DoD =** 本番実機目視（クロス表左端／通称表示 大阪BC／現級優勝者除外／勝率チップ）。migration 0038 は auto-deploy の db:migrate に乗る（手動バックフィル不要）。
