---
name: impl_senseki_ranking_drilldown
description: ランキング→選手詳細ドリルダウン絞り込み SHIPPED（PR#242 merge 82437b6・全3タスク）
metadata: 
  node_type: memory
  type: project
  originSessionId: 9a7ce289-ae60-49b8-acd8-ccbee8278c7d
---

**senseki-ranking-drilldown SHIPPED（2026-07-02）。PR#242 merge `82437b6`・親#236+子#237-239 全クローズ・migration なし。定義=[[project_senseki_ranking_drilldown_def]]。残=本番実機目視（auto-deploy はコード変更のみ＝適用済み）。**

Codex 1R(high) verdict=pass・0指摘（111,521 tokens）・CI green。vitest 1035 green（新規=queries.test 8＋scopeLabel 13）・check-types/lint green。

**実装（3コミット・1PR）:**
- T1 #237 `001afca` `getPlayerRecord(playerId, opts?{filter,bracketAtMost})`。filter 時のみ①(期間+級)で
  対象 participant id を軽量 join で先絞り→relational findMany に `inArray` 追加。②(bracketAtMost=1/8)は
  **一覧の id 絞りのみ**、ヘッダ集計(優勝/入賞/出場/活動年/勝敗)は①母集合を `derived_bracket` で数える
  （ランキングと単一定義）。`ranking.ts filterConds` を **export して共用**＝セマンティクス単一ソース。
- T2 #238 `16c996d` `[id]/scopeLabel.ts` 純関数=formatRankingScopeLabel（「2021〜2026年・A級大会での成績」・
  ②は「（優勝/入賞した大会のみ表示）」）/ buildClearScopeHref（現 params 複製+all=1）/ metricBracketAtMost。
- T3 #239 `c39b15a` page.tsx 配線。`from=ranking && all!=1` で parseRankingParams→{filter,bracketAtMost}を
  getPlayerRecord へ。条件表示行＋解除リンク・0件専用空状態。

**非自明:**
- **identity 分離が肝**: 現級・ヘッダ所属を絞り込みで変えない。フィルタ時は全成績ベースの軽量クエリで別取得
  （event_date desc **nulls last**, id desc の直近1件・searchPlayers 相関と同型）。PlayerRecord に
  `currentAffiliation` を追加し page ヘッダは `participations[0].affiliation`→`currentAffiliation` に変更
  （非フィルタ時も同値＝挙動不変）。
- **ヘッダ集計は derived_bracket 直読み**（非フィルタは従来の derivePlacement 導出のまま＝回帰維持）。
  受け入れ基準の整合テスト=6指標とも `getPlayerRanking` 同条件値と一致（winRate は record 側 minMatches 無視
  なのでランキングを minMatches=1 で足切り解除して比較）。
- **⑤現級 membership の罠**: 級指定ランキングは「現級∈選択級」で母集団を絞る。整合テストの選手は現級を
  選択級(A)に揃えないとランキング行に出ず比較不能（identity 分離テストは逆に現級を別級 B にして検証）。
- 空 `inArray` は drizzle に渡さない（`listIds.length===0 → []`）＝コードベース既存パターン。
- テスト DB は worktree 隔離 `kagetra_test_drilldown`（空DB作成→global-setup の drizzle-kit push が schema 投入）・
  接続は 127.0.0.1（localhost IPv6 ECONNRESET 回避）。`as const` grades は readonly→StatsFilter 注釈で解消。

feature docs は main で未 commit(untracked)だったので worktree にコピーして PR 同梱。並行 refinements は
既に PR#240 で ship 済＝ranking.ts 干渉の懸念は解消。
