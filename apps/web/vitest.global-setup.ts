import { execSync } from 'node:child_process'
import { ensureTestDatabase, resolveTestDatabaseUrl } from '@kagetra/shared/test-db'

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
}
