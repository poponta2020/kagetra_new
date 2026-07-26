---
name: feedback_shared_test_db_worktree_push_race
description: 並行 worktree の test DB 衝突は自動隔離で解決済み（vitest が worktree ごとに DB を導出・自動作成）。手動 createdb は不要
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c9cb1b98-a35e-454a-97c5-8ccec1f015d5
---

**【解決済み 2026-07-26】** vitest は `@kagetra/shared/test-db`（`packages/shared/src/test-db.ts`）で **worktree パスから DB 名を自動導出し、postgres-test(5434) 上に自動作成**するようになった。`TEST_DATABASE_URL` 未設定なら worktree ごとに別 DB になるため、以下の衝突は通常発生しない。手動の `createdb`・`TEST_DATABASE_URL` 設定は不要（明示すれば上書き可能。CI は明示している）。同一 worktree 内での vitest 並行起動だけは今も競合する（`## parallel` の worker_verify: none を維持）。以下は経緯の記録:

vitest の global-setup は `drizzle-kit push --force` で **共有 test DB（`localhost:5434/kagetra_test`）** にスキーマを焼く。**2 つの worktree が同時にテストを走らせると、互いの push がスキーマを上書きし合う**（片方が新表を足し、もう片方が旧 schema を push して消す）→ truncateAll や query が存在しない表を引いて `42P01 (relation does not exist)` で大量 fail。

**Why**: push は冪等 sync で、DB を「現在の TS schema」に強制一致させる。別ブランチの schema は別物なので、後勝ちで相手の表が消える。2026-06-29 tournament-entry-rosters PR-1 のテストで、別 worktree(import-past-results) の並行 vitest が series 表を消し 320 件 fail（コードは正常）。

**How to apply**: 他 worktree がテスト中なら、自分のテストは **隔離した test DB** に向ける。
`createdb kagetra_test_<slug>`（5434 上）→ `TEST_DATABASE_URL=postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test_<slug>` を設定して vitest 実行（global-setup の push も test-utils/db.ts の pool も同 env を見る）。`tasklist | grep -ci node` で他 node プロセスの有無を確認できる。[[feedback_vitest_no_file_parallelism]] とは別問題（あちらは時刻ドリフト）。
