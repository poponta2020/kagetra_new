---
name: feedback_no_shared_maindir_for_branch_work
description: ブランチ作業は共有 main 作業ディレクトリでやらず必ず隔離 worktree で。並行セッションと衝突する
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7ac76341-fb6b-44c8-9630-2b9826cb7193
---

ブランチ作成・`git checkout`・コミットを**共有 main 作業ディレクトリ (`c:/Users/popon/kagetra_new/kagetra_new`) で直接やってはいけない**。必ず `C:/tmp/...` の隔離 worktree を作って作業する。

**Why**: 2026-06-01、auto-deploy の PR を main ディレクトリで `git checkout -b ci/auto-deploy` + `git checkout main` して作業したところ、同時刻に別セッション（event-lifecycle-notify の /ship）が同じ main 作業ディレクトリを使っており、作業ツリーのブランチが `ci/auto-deploy ↔ main` で揺れて衝突。相手は安全のため自分の worklog/memory 同期を中断する羽目になった。CLAUDE.md ルール11（並行作業管理）と worktree 隔離原則の違反。

**How to apply**:
- 1 タスク = 1 worktree（`/implement` 等のスキルが元々そうしている）。infra/CI/ちょっとした PR でも例外なく worktree を切る
- 共有 main ディレクトリには「read-only 確認」以外で触れない。特に `git checkout`/`commit`/`reset` は厳禁（他セッションのブランチ状態・未コミット変更を壊す）
- 他セッションの未コミット変更（例: `.claude/skills/*`, `CLAUDE.md`）を見つけたら絶対に add/commit/restore しない
- worklog/memory の main 同期 commit すら、衝突中は隔離 worktree 経由か、repo が main で静止してから行う

関連: [[feedback_windows_worktree_path]]（worktree は `C:/tmp/...` で明示作成）、[[project_dev_rules]]（ルール11 並行作業管理）、[[project_auto_deploy]]
