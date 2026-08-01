---
name: feedback-windows-ship-worktree-remnant
description: ship後のworktree残骸が次の着手を止める
type: feedback
---

Windows では `/ship` の worktree 削除（ship-finalize.sh → remove-worktree.sh）が長いパスで失敗し、**`.git` と一部のディレクトリだけ消えた壊れた残骸**が C:/tmp/impl-<slug>/ に残る。

**Why**: 残骸は git から見ると worktree ではないので `git worktree prune` でも消えず、次に同じ slug で `ensure-worktree.sh` を実行すると `fatal: '...' already exists` で止まる。実測 2026-08-01: PR #409 の残骸が PR #439 の着手を妨げ、その PR #439 の出荷でも同じ残骸ができた（毎回起きる）。remote の feature ブランチも `--delete-branch` で消えずに残るため、ensure-worktree がマージ済みの古い tip を追跡するブランチを作ってしまう二次被害もある。

**How to apply**:
1. 着手時に `fatal: already exists` が出たら、残骸を退避（`mv ... .stale-YYYYMMDD`）→ `git branch -f feature/<slug> main` で古い tip を捨ててから ensure-worktree を再実行する。
2. 削除は **Git Bash の `rm -rf`** を使う。PowerShell の `Remove-Item -Recurse -Force` は node_modules の深いパスで MAX_PATH エラーを大量に出して消し切れない。
3. `git worktree remove --force` は使わない（junction を辿ってリンク先の実体を壊す）。remove-worktree.sh が junction を外してから消す。
4. 出荷後に `ship-finalize.sh` が `worktree_remove_failed=1` / `branch_deleted=skip:worktree-remains` を返したら、その場で残骸を消し、`git branch -D` と `git push origin --delete` も自分で行う。
