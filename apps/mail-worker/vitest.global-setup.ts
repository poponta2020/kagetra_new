import { execSync } from 'node:child_process'
import {
  dropWorkerTestDatabases,
  ensureTestDatabase,
  resolveTestDatabaseUrl,
} from '@kagetra/shared/test-db'

/**
 * Vitest global setup. Pushes the current Drizzle schema to the (per-worktree)
 * test DB once before any test file. Mirrors apps/web/vitest.global-setup.ts so
 * we can rely on `mail_messages` existing without needing an explicit migration
 * step in CI.
 */
export default async function setup() {
  const dbUrl = resolveTestDatabaseUrl()

  console.log('[mail-worker test-setup] Applying schema to', dbUrl)

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
  if (dropped > 0)
    console.log('[mail-worker test-setup] Dropped', dropped, 'stale worker database(s)')

  // teardown: 実行が終わったら worker DB を片付ける（postgres-test は tmpfs で、
  // 複製が居座ると積み上がって `No space left on device` になる）。
  return async () => {
    const removed = await dropWorkerTestDatabases(dbUrl)
    if (removed > 0)
      console.log('[mail-worker test-setup] Cleaned up', removed, 'worker database(s)')
  }
}
