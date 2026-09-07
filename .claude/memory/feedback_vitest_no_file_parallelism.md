---
name: feedback_vitest_no_file_parallelism
description: vitest は worker ごとのテスト DB で並列実行する。DB 名は VITEST_POOL_ID で作る（VITEST_WORKER_ID だと tmpfs を食い潰す）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c06bad42-a4c1-4908-bc80-f4ab3c3c287d
---

vitest は**ローカルでは並列・CI では直列**（`fileParallelism: !process.env.CI`）。テスト DB は worker ごとに分かれる（`@kagetra/shared/test-db` の `resolveWorkerTestDatabaseUrl` / `ensureWorkerTestDatabase`）。ローカル実測（12コア）: web 675s→188s、mail-worker 69s→20s。

★**CI で並列化してはいけない**。GitHub `ubuntu-latest` は 4 vCPU しかなく、worker 3つ＋同じコアに載る Postgres が奪い合って**遅くなる**。実測（run 34094874364）: 集計テスト時間 600s→2278s、Vitest ステップ実時間 12分→14.5分、さらに `beforeEach(truncateAll)` が 10 秒の hookTimeout を超えて 1 ファイル失敗。**コア数が足りない環境では直列の方が速い。** CI を速くしたいなら worker を増やすのではなく `--shard` でジョブ（＝ランナー）を分割する。

**Why**: 以前は全テストファイルが1つのテスト DB を共有していたため直列化が必須で、Vitest だけで約11分かかり CI の timeout を押し上げていた。いまは worktree 単位の DB を**テンプレート**にして `CREATE DATABASE … TEMPLATE` で `<name>_w<VITEST_POOL_ID>` を複製する。同じプール枠に流れるファイルは直列なので truncate/insert の決定性は保たれる。

**旧・逐次実行の理由（`--no-file-parallelism`）はもう無い**: WSL2 Docker DB のクロックドリフトで時刻境界テストが flaky になる問題は、Issue #275 / PR #276 で時刻範囲クエリを ID 直接収集に置換して**根治済み**（[[impl_mail_worker_clock_drift_draft_subjects]]）。`pipeline-runs.test.ts` に「worker の時計を 5 秒進めても通る」回帰テストがある。並列で 6 回連続 green を実測して確認した。

**How to apply**:
- **DB 名には `VITEST_POOL_ID` を使う。`VITEST_WORKER_ID` は使わない。** 前者はプールの枠番号（1..maxWorkers）、後者は worker インスタンスの通し番号で、既定の `isolate: true` ではテストファイルごとに増える。取り違えると DB がファイル数だけ作られ、`postgres-test`（tmpfs 3.2G）を使い切って `could not write block N: No space left on device` で大量に落ちる（実測: web 288 ファイルで DB 202 個・72 ファイル失敗）。回帰テスト= `packages/shared/__tests__/test-db.test.ts`
- **落ちたら flaky を疑う前に「重量級テストのタイムアウト」を疑う。** 並列化で CPU/IO を取り合うため、単独なら数秒で終わるテストが既定 5 秒（hook は 10 秒）を超えることがある（実例: `classify/classifier.test.ts` の 36MiB 本文を Postgres 往復するケース。単独 1.4 秒 → 並列で timeout。`{ timeout: 30_000 }` を個別に付けて解決）。**並列化をやめる理由にはしない**
- globalSetup が実行前後に worker DB を drop する（前回のスキーマ残りの再利用防止＋tmpfs の掃除）。前提は「1 worktree = 1 vitest プロセス」（`## parallel` in .claude/project-profile.md）
- `pnpm test` は `turbo run test --concurrency=1` で web / mail-worker / shared を直列に回すので、プロジェクト間で DB がぶつかることはない

関連: [[feedback_shared_test_db_worktree_push_race]] / [[feedback_windows_localhost_econnreset_docker_pg]] / [[feedback_drizzle_kit_push_prompt]]
