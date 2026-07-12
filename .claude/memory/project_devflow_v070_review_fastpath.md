---
name: project_devflow_v070_review_fastpath
description: devflow v0.7.0(2026-07-12) 小差分レビューパイプライン高速化。CI委譲・スコープ付きコマンド・trivialティア・ACチェック条件付きスキップ。PR#1028実測60分の精査が発端
metadata:
  type: project
---

# devflow v0.7.0 レビューパイプライン高速化（2026-07-12）

**発端**: match-tracker PR #1028（純UIタブ改修・161行・6ファイル）が /implement 起動→ship に60分。精査の結果、Codex 指摘 0件・AC 全 satisfied の1ラウンド即収束で、**時間はレビューの発見ではなくパイプラインの固定費**だった（同一テストスイート最大4回実行／verify 直後の AC 再検証／memory 記録3回／codex JSON の worktree↔main パス不整合）。

**claude-devflow commit 3c2428c（v0.7.0）で導入した仕組み**:

1. **CI 委譲**: profile の `DEVFLOW_CI_COVERS=("test" "lint" "typecheck")` に宣言された項目は、gate-dod.sh が CI green 時にローカル再実行せず「CI green に委譲」で PASS。CI 未 green なら SKIP（B1 が FAIL するので穴なし）
2. **スコープ付きコマンド**: `DEVFLOW_*_CMDS` のエントリを `パス前方一致::コマンド` と書くと、PR/タスク差分が該当する時だけ実行（gate-dod / implement Step7・12 / fix Step6 共通）。同一コマンドを複数スコープが指す場合は1回だけ実行
3. **trivial ティア**: auto-review-loop の auto ルーブリックに追加。差分<150行・ファイル≤4・全変更が profile 宣言の**低リスクパス**内 → Codex effort=low。low で指摘が出たら次ラウンド medium へ昇格
4. **AC 適合チェックの条件付きスキップ**: trivial かつ R1 pass かつ PR 本文の `Verified: live (...)` 行が verify 手段の AC を全カバー → acceptance-reviewer(Opus) をスキップ。/fix 後（R≥2）は必ず実施
5. **memory 集約**: 1R pass のラウンド記録は作らず /ship の出荷記録に集約
6. **codex JSON パス根治**: RESULT_FILE を `git worktree list` 先頭（=メインリポジトリ）に固定。gate-dod C1 の手動コピー不要に
7. **implement 高速パス**: タスク≤2 かつ design-prototype.patch ありの純UI機能は Advisor 相談（アプローチ確定前・完了前チェック）を省略可

**受け側設定**: kagetra は profile に scoped test（@kagetra/web|api|mail-worker、shared は全体実行）+ CI_COVERS 3点 + 低リスクパス（apps/web/src/components の表示専用+docs）。match-tracker は gradle/vitest 分離 + CI_COVERS は test のみ（**lint は CI 未組込**）+ 低リスクパス（karuta-tracker-ui/src ただし api/ 除く）。

**期待効果**: PR#1028 相当で 60分→35分前後（PR後 17分→6〜8分）。**初回実走時に trivial 判定・Verified 行伝搬・CI 委譲の動作を確認すること**（未実走）。

関連: [[project_codex_review_effort]]（v0.7.0 で low を追加拡張）
