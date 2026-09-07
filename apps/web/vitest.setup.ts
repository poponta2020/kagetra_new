import {
  ensureWorkerTestDatabase,
  resolveWorkerTestDatabaseUrl,
} from '@kagetra/shared/test-db'

// Force DATABASE_URL to the test DB so that @/lib/db (top-level Pool) connects
// to the postgres-test container. Tests are destructive (TRUNCATE) so this must
// never point at a dev/prod DB. TEST_DATABASE_URL is pinned too so anything
// re-resolving inside this process (test-utils/db, spawned helpers) lands on
// the same database.
//
// ★**worker ごとに別の DB** を使う（`<worktree DB>_w<VITEST_POOL_ID>`）。
// globalSetup がスキーマを push した DB をテンプレートに複製するので、
// テストファイルが1つの DB を奪い合わなくなり `fileParallelism` を有効にできる。
// 複製は初回だけで、同じ worker の2ファイル目以降は globalThis のフラグで飛ばす
// （setupFiles は isolate のためテストファイルごとに再実行される）。
const testDbUrl = resolveWorkerTestDatabaseUrl()
process.env.TEST_DATABASE_URL = testDbUrl
process.env.DATABASE_URL = testDbUrl

const readyKey = Symbol.for('kagetra.testDbReady')
const g = globalThis as unknown as Record<symbol, string | undefined>
if (g[readyKey] !== testDbUrl) {
  await ensureWorkerTestDatabase(testDbUrl)
  g[readyKey] = testDbUrl
}

// LINE link state cookie signing uses AUTH_SECRET. Provide a fixture value
// so `buildLineLinkStateCookie` / `verifyLineLinkStateCookie` work under
// Vitest without requiring the developer's local .env to leak in.
process.env.AUTH_SECRET ??= 'vitest-line-link-state-secret'
