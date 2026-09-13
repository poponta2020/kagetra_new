---
name: feedback-vitest-close-test-db-per-describe
description: closeTestDb は describe ごとに置かない
type: feedback
---

DB を使う vitest ファイルに **describe を追加**するとき、既存 describe が持つ `afterAll(async () => { await closeTestDb() })` をそのまま真似て新 describe にも置くと、**先に終わった describe が `testPool.end()` を呼んで pool を閉じ、後続 describe の `beforeEach` の `truncateAll()` が "Failed query: TRUNCATE TABLE ..." で全滅する**。

**Why:** `apps/web/src/test-utils/db.ts` の `closeTestDb()` は module-level singleton の `testPool.end()` で、閉じた pool は再利用できない。vitest の suite 単位 `afterAll` はその suite が終わった時点で走るため、ファイル内に describe が複数あると最初の describe の終了時に pool が死ぬ。

**How to apply:** `closeTestDb()` は **ファイル末尾のトップレベル `afterAll` 1 箇所だけ**に置く（describe の中に置かない）。新しい describe を足すときは、既存 describe 側の `afterAll(closeTestDb)` も同時に末尾へ集約する。

**見つけにくさ:** `-t "<テスト名>"` で 1 件だけ実行すると他の describe が skip されて **pass してしまう**。切り分けるときはファイル全体を実行すること。2026-09-13 の tournament-results 改修（page.test.tsx に describe 追加）で実際に8ケース全滅した。関連 = [[feedback_shared_test_db_worktree_push_race]] / [[feedback_vitest_no_file_parallelism]]
