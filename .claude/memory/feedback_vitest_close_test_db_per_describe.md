---
name: feedback-vitest-close-test-db-per-describe
description: closeTestDb は describe ごとに置かない
type: feedback
---

DB を使う vitest ファイルに **describe を追加**するとき、既存 describe が持つ `afterAll(async () => { await closeTestDb() })` をそのまま真似て新 describe にも置くと、**後続 describe の `beforeEach` の `truncateAll()` が "Failed query: TRUNCATE TABLE ..." で全滅する**。

**How to apply:** `closeTestDb()` は **ファイル末尾のトップレベル `afterAll` 1 箇所だけ**に置く（describe の中に置かない）。新しい describe を足すときは、既存 describe 側の `afterAll(closeTestDb)` も同時に末尾へ集約する。2026-09-13 の tournament-results 改修（page.test.tsx に2つ目の describe を追加）で8ケース全滅 → この形にして 20/20 green を実測。

**★機構は未特定（断定しないこと）:** 素直な説明は「`closeTestDb()` = module-level singleton の `testPool.end()` で、先に終わった describe の `afterAll` が pool を閉じる」だが、**`actions.test.ts` は先頭 describe だけに `afterAll(closeTestDb)` を持ち、後続に describe が4つあるのに 222 件 pass している**ので、これだけでは説明がつかない。原因を断定した修正（例: actions.test.ts を"直す"）に走らないこと。対処の形だけ守れば足りる。

**見つけにくさ:** `-t "<テスト名>"` で 1 件だけ実行すると他の describe が skip されて **pass してしまう**。切り分けるときはファイル全体を実行すること。関連 = [[feedback_shared_test_db_worktree_push_race]] / [[feedback_vitest_no_file_parallelism]]
