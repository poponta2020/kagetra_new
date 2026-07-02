---
name: reference_worktree_vitest_db_setup
description: worktree で vitest を回すときの test DB 前提（.env コピー・Node24 は 127.0.0.1・隔離DB）
metadata: 
  node_type: memory
  type: reference
  originSessionId: fb3d5802-ba78-4e85-85dc-4bb4748429a2
---

worktree（`C:/tmp/impl-*`）で `apps/web` の vitest を回すときに必要な段取り。3 つとも非自明で、放置すると global-setup が謎の exit 1（"undefined"）や `ECONNRESET` で全テストが起動しない。

1. **`.env` を main からコピー必須。** worktree には gitignored の `.env` が無い。`packages/shared/drizzle.config.ts` は `import 'dotenv/config'` で DATABASE_URL を読むため、無いと global-setup の `drizzle-kit push` が失敗する。`cp` で root `.env` と `packages/shared/.env`（＋あれば `apps/web/.env.local`）を持ってくる。

2. **Node 24 は `localhost`→IPv6(`::1`) を優先し Docker Desktop のポートプロキシで `ECONNRESET`。** `pg`/`drizzle-kit` が 5434 に繋がらず push が "Pulling schema..." 直後に無言 exit 1 する。**TEST_DATABASE_URL は必ず `127.0.0.1` で書く**（`localhost` 不可）。`docker exec ... psql` はコンテナ内接続なので成功してしまい、原因の切り分けを誤らせる。

3. **並行 worktree の共有 test DB 衝突回避に隔離 DB を使う（[[feedback_shared_test_db_worktree_push_race]]）。** `kagetra-db-test`（5434）内に専用 DB を作り、schema は稼働中 `kagetra_test` から `pg_dump --schema-only | psql` でコピーしておく（空 DB への drizzle push は上記2の ECONNRESET で hang するので、既存 schema を種にすると global-setup の push は差分適用で通る）。以後の実行は:

```
docker exec kagetra-db-test psql -U kagetra -d postgres -c "CREATE DATABASE kagetra_test_psr"
docker exec kagetra-db-test sh -c "pg_dump -U kagetra -d kagetra_test --schema-only --no-owner --no-privileges | psql -U kagetra -d kagetra_test_psr -q"
cd <worktree>/apps/web
TEST_DATABASE_URL="postgresql://kagetra:kagetra_dev@127.0.0.1:5434/kagetra_test_psr" npx vitest run --no-file-parallelism
```

`--no-file-parallelism` は [[feedback_vitest_no_file_parallelism]] のとおり時刻境界テストの flaky 回避で常用。global-setup が毎回 FK 制約を DROP/ADD する churn が出るが（pg_dump 由来の制約名切り詰め差）、テスト結果には無害。
