import { execSync } from 'node:child_process'
import {
  dropWorkerTestDatabases,
  ensureTestDatabase,
  resolveTestDatabaseUrl,
} from '@kagetra/shared/test-db'

/**
 * Vitest global setup. Runs once before any test file.
 *
 * Resolves the per-worktree test database (see @kagetra/shared/test-db), creates
 * it on the postgres-test container if missing, then applies the current Drizzle
 * schema via `drizzle-kit push --force`. `--force` auto-approves data-loss
 * statements so the push is non-interactive. This is safe because the test DB is
 * ephemeral (see docker-compose `postgres-test` tmpfs).
 *
 * TEST_DATABASE_URL may be set explicitly to override the derivation (CI does
 * this; so can a developer who wants a specific DB).
 */
export default async function setup() {
  const dbUrl = resolveTestDatabaseUrl()

  console.log('[test-setup] Applying schema to', dbUrl)

  await ensureTestDatabase(dbUrl)

  execSync(
    'pnpm --filter @kagetra/shared exec drizzle-kit push --force --config=drizzle.config.ts',
    {
      stdio: 'inherit',
      // `shell: true` is required on Windows so `pnpm` (a .cmd shim) is resolved via PATH.
      shell: true,
      env: { ...process.env, DATABASE_URL: dbUrl },
    },
  )

  // ★この DB は以後**テンプレート**として使い、各 vitest worker は
  // `<name>_w<VITEST_POOL_ID>` を CREATE DATABASE ... TEMPLATE で複製する
  // （vitest.setup.ts）。前回実行の worker DB が残っていると**古いスキーマのまま
  // 再利用される**ので、push 直後にすべて落として作り直させる。
  const dropped = await dropWorkerTestDatabases(dbUrl)
  if (dropped > 0) console.log('[test-setup] Dropped', dropped, 'stale worker database(s)')

  // teardown: 実行が終わったら worker DB を片付ける。postgres-test は tmpfs
  // （既定 3.2G）で、worktree ごとの複製が居座ると積み上がって
  // `No space left on device` になる（2026-09-07 に実際に発生）。
  // 冒頭の drop と同じ「1 worktree = 1 vitest プロセス」前提に乗っている
  // （`## parallel` in .claude/project-profile.md）。
  return async () => {
    const removed = await dropWorkerTestDatabases(dbUrl)
    if (removed > 0) console.log('[test-setup] Cleaned up', removed, 'worker database(s)')
  }
}
