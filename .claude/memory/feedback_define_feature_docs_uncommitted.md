---
name: feedback_define_feature_docs_uncommitted
description: define-featureが作るdocs/features/<name>/*.mdはgit commitされずメイン作業ツリーにuntrackedのまま残る。/implementのworktreeはorigin/mainから作るため必ず欠落する。
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f90c38f4-ec05-427f-85af-dd094bdf6351
---

`/define-feature` スキル（`.claude/skills/define-feature/SKILL.md`）は `requirements.md`／`implementation-plan.md` を書くだけで、git add/commit を一切行わない。そのため要件定義完了後もメインの作業ツリーに untracked ファイルとして残り続ける（`git status` で `?? docs/features/<name>/` と出る）。

**Why:** `/implement` は `git worktree add <path> -b feature/<summary> origin/main` でリモートの main から worktree を作る。untracked ファイルはリモートに存在しないので worktree には反映されず、要件定義書・実装手順書が worktree 内に無い状態で実装を始めることになる（2026-07-05, player-tournament-shortname で発覚）。

**How to apply:** `/implement` の Step 6（worktree作成）の直後、Step 2 で読んだ `docs/features/<機能名>/` 配下のファイルが worktree 内に存在するか確認する。無ければメイン作業ツリーから `cp` して worktree 側で `git add && git commit`（進捗チェックボックス更新も一緒に）してから実装タスクへ進む。逆に `/define-feature` 側を直す（要件定義書完成時に commit させる）のも将来の改善候補だが、今回はスコープ外として `/implement` 側での吸収に留めた。
