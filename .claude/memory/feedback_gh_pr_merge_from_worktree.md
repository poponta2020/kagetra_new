---
name: feedback_gh_pr_merge_from_worktree
description: "gh pr merge --delete-branch を worktree cwd から実行するとリモートのマージは成立するがローカル後処理が \"main is already used by worktree\" で失敗する"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 32a56b0a-1940-4426-afac-05ec27126b11
---

`gh pr merge {N} --merge --delete-branch` を **worktree の cwd から**実行すると、リモートのマージ自体は成立する（直後に `gh pr view {N} --json state,mergeCommit` で `state=MERGED` を確認できる）が、コマンドはローカル後処理でこけて exit 1 を返す:

```
failed to run git: fatal: 'main' is already used by worktree at 'C:/Users/popon/kagetra_new/kagetra_new'
```

さらに **`--delete-branch` のリモートブランチ削除も後処理失敗の巻き添えで効かない**ことがある（`git ls-remote --heads origin {branch}` で残存確認 → `git push origin --delete {branch}` を手動実行する必要があった。2026-06-17 PR #156 で実害）。

**Why:** gh はマージ成功後に「現在チェックアウト中のブランチから離れて削除」しようとし、フォールバックでデフォルトブランチ main を checkout しようとする。worktree 構成では main が本体ディレクトリ側で使用中のため切替できず、後処理一式（ローカルブランチ削除・リモートブランチ削除）が中断する。

**How to apply:** worktree ベースの ship では—
1. exit 1 でも慌てず、まず `gh pr view {N} --json state,mergedAt,mergeCommit` でリモートのマージ成立を確認する。
2. 後始末は手動で行う: cwd を**本体ディレクトリへ移してから**（worktree 内 cwd のままだと worktree 削除が Device busy になる）`git push origin --delete {branch}` → `git worktree remove --force {path}` → `git branch -D {branch}`（ローカル main がまだ ff していないと `-d` は "not fully merged" で蹴られるので、origin/main 内在を確認済みなら `-D`）。
3. もしくは gh pr merge 自体を本体ディレクトリ cwd から実行すればローカル後処理も通る。

関連: [[feedback_no_shared_maindir_for_branch_work]] / [[feedback_windows_worktree_path]] / [[feedback_main_push_authorized_for_ship]]
