---
name: impl_senseki_stats_pr1_derived_bracket
description: senseki-stats PR-1 基盤（derived_bracket schema/migration/materialize/backfill）SHIPPED
metadata: 
  node_type: memory
  type: project
  originSessionId: e7d50e95-5792-4c22-816c-1c07d789d18a
---

senseki-stats（[[project_senseki_stats_tab]]）の **PR-1 基盤（タスク1-3）SHIPPED**。
**PR #220 merge `7661fae`（2026-07-01・/implement→prepare-pr→auto-review-loop→ship 自律完走）**。
子 Issue #209/#210/#211 全クローズ・親 #208 のPR-1チェック [x] 済（#208 は PR-2〜5 残で OPEN 継続）。

**やったこと:** `tournament_participants.derived_bracket smallint`(null許容) を追加し、順位
bracket（1=優勝/2/4/8…、導出不能級=null）を参加グレインで事前計算。②大会詳細の級別順位・
③優勝(=1)/入賞(≤8)ランキング・②歴代優勝者の共通基盤。migration **0037**（0036の次・prevId連鎖OK）。

**非自明:**
- **順位定義は単一ソース**＝新設した純関数 `deriveClassBrackets(participants)`（apps/web/src/lib/players/placement.ts）。
  内部で `isDerivableClass`→`derivePlacement` の2段を級一括で回し、participantId は入力 index を使う。
  materialize / backfill / getPlayerRecord が全部これに合意（戦績詳細と同じ順位が出る）。
- index は **部分 index** `(derived_bracket, player_id) WHERE derived_bracket IS NOT NULL`
  ＝優勝/入賞は bracket で range 絞り→player_id 順 GROUP BY count が効く。導出不能(null)は集計外なので除外し軽量化。
- materialize は級ごとに bracket を **participant insert より前に** 一括算出して `derivedBracket` を values に載せる（Pass3 UPDATE 不要）。
- backfill(`apps/web/scripts/backfill-derived-bracket.ts`)＝級idチャンク読み→deriveClassBrackets→
  bracket値ごとに `id=ANY($) AND derived_bracket IS DISTINCT FROM $` で冪等 UPDATE・`--dry-run`(書かず件数)・summary返却でテスト可能。
- **リーグ級は全 null で final_rank 温存**（isDerivableClass=false）＝呼び出し側フォールバック元を壊さない。

**Codex auto-review:** R1 needs_changes(blocker=partial bracket・should_fix=snapshot欠落) → **どちらも非actionable**
＝blocker は「級一括を all-or-nothing に丸めろ」だが getPlayerRecord も per-participant で `derivable?derivePlacement:null`
なので丸めると保存値が戦績詳細と乖離＝§4.1 違反（override）／should_fix は巨大 snapshot を diff 除外していた
false positive。対応＝**丸めず**に不変条件を明示するコメント＋**DB-backed SSOT テスト**（保存 derived_bracket ==
getPlayerRecord.rankBracket を導出/非導出/0試合異常級で検証）を追加(commit `c12ff1a`)＋R2 は snapshot 込み diff で
再レビュー→**R2 pass**（2R・~280k tokens・high effort）。CI green(5m33s)→auto-ship。

**検証:** shared 19 + web 813 green・型チェック green（shared/web）。**mail-worker pipeline-runs の
2 fail は既知 flaky**（同一コード/DB で run1 pass→run2 fail を再現・main でも flap＝[[feedback_vitest_no_file_parallelism]]・
私の変更は mail-worker 非依存）。CI 落ちたら `gh run rerun --failed`。

**worktree の罠:** 要件/計画/design-spec は main で untracked（`?? docs/features/senseki-stats/`）だったので
worktree に手コピーして PR-1 に同梱（design-spec/requirements/implementation-plan[タスク1-3を[x]]）。
テストは shared test DB 競合回避に isolated DB `kagetra_test_bracket`(5434) を作成（[[feedback_shared_test_db_worktree_push_race]]）。

**残 DoD:** 本番反映＝PR ship 後に migration 0037 適用 + backfill を dump/apply（[[project_bulk_load_handover]] と同じく
series 層含む db:migrate 運用・db:push 禁止）。次 PR＝PR-2 ナビ（#212, タスク4）は PR-1 と並行可。
