---
name: feedback_vitest_no_file_parallelism
description: WSL2 Docker test DB のクロックドリフトで時刻境界テストが並行 vitest で flaky。--no-file-parallelism で逐次実行する
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c06bad42-a4c1-4908-bc80-f4ab3c3c287d
---

vitest をローカル検証するときは `pnpm exec vitest run --no-file-parallelism`（逐次実行）で回す。並行実行（既定）だと時刻境界に依存するテストが flaky になる。

**Why**: WSL2 の Docker DB コンテナ（test DB `localhost:5434/kagetra_test`）はホストとサブ秒〜1秒超のクロックドリフトがある（`SELECT now()` をホスト時刻と比較すると確認できる）。`gte(createdAt, startedAt)` のような時刻境界をまたぐアサーション（mail-worker の pipeline-runs テスト、子プロセス起動を挟む reextract テスト等）が、並行実行でタイミングがずれると DB now() とプロセス時刻の前後関係が逆転して落ちる。コード側のバグではなく検証環境の罠。

**How to apply**: ローカルで vitest を流すときは常に `--no-file-parallelism` を付ける（CI は別ホストで安定するので付いていなくても通る）。落ちたテストが時刻・タイムスタンプ比較系なら、コードを疑う前にまず逐次実行で再現するか確認する。dev DB(5433) は古いスキーマのことがあるので、検証は test DB(5434) を最新 migration 適用済みで使う。関連: [[feedback_windows_worktree_path]]
