---
name: ship-test-db-isolation
description: テスト DB の worktree 自動分離
type: project
---

テスト DB の worktree 自動分離を出荷した。PR #337 https://github.com/poponta2020/kagetra_new/pull/337（マージ済み: d7822de）。

- packages/shared/src/test-db.ts 新設: worktree ルートのパスから DB 名を決定論的に導出（kagetra_test_<slug>_<hash>）し、postgres-test(5434) 上に自動作成する。TEST_DATABASE_URL 明示時はそれを優先（CI は明示しているため挙動不変）。既定ホストは 127.0.0.1（localhost の IPv6 ECONNRESET 回避）。
- 以後、並行 worktree のテスト実行は手動 createdb なしで自動隔離される。[[feedback_shared_test_db_worktree_push_race]] は解決済みに更新。同一 worktree 内の vitest 並行起動は引き続き禁止（## parallel の worker_verify: none 維持）。
- レビュー: Codex R1 needs_changes（POSIX の case 衝突・明示 URL 時の管理 DB 接続）→修正→ R2 pass（effort medium、R2 tokens 85,526）。CI green（13m56s）。
- 経緯: PR #334 出荷時に共有 test DB 汚染で偽陽性58件×2回が発生したポストモーテム対応。devflow プラグイン側も v0.13.0 で DIRTY PR 早期検出（gate-dod B0）・レビュー差分の docs 除外を導入。
