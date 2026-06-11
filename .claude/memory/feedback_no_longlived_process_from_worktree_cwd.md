---
name: no-longlived-process-from-worktree-cwd
description: "worktree 内の cwd から Docker Desktop 等の長寿命プロセスを起動すると cwd 継承でハンドル保持され worktree 削除が \"Device or resource busy\" になる"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 034d2100-c205-4fbf-b2ce-37d04ceb6677
---

worktree 内に shell の cwd がある状態で `Start-Process`（PowerShell）等から長寿命プロセス（Docker Desktop など）を起動すると、子プロセスが cwd を継承してディレクトリハンドルを保持し続け、worktree 削除時に root ディレクトリが `Device or resource busy` で消せなくなる（中身は消えても空ディレクトリが残る）。

**Why:** Windows はオープン中のハンドルを持つディレクトリを削除できない。Bash / PowerShell ツールの cwd は呼び出し間で永続するため、worktree に cd したまま起動した子プロセスへそのまま伝播する。2026-06-11 PR #136 の ship 時に実害（Docker Desktop が `C:/tmp/fix-internal-deadline-default` を保持、空ディレクトリ残存）。

**How to apply:** 長寿命プロセスを起動する前に `Set-Location` / `cd` で cwd を main リポジトリ等 worktree 外へ移す。worktree 削除前には Bash と PowerShell **両方**の cwd を worktree 外へ移動してから `git worktree remove`（`git worktree remove` が "Filename too long" で落ちる場合は `rm -rf` 後に `git worktree prune`）。関連: [[windows-worktree-path]]
