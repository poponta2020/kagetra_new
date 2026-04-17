import { execSync } from 'node:child_process'

/**
 * Vitest global setup. Runs once before any test file.
 *
 * Applies the current Drizzle schema to the test database via `drizzle-kit push --force`.
 * `--force` auto-approves data-loss statements so the push is non-interactive. This is safe
 * because the test DB is ephemeral (see docker-compose `postgres-test` tmpfs).
 *
 * TEST_DATABASE_URL may be set explicitly; otherwise falls back to the docker-compose
 * `postgres-test` service URL (port 5434).
 */
export default async function setup() {
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'

  // eslint-disable-next-line no-console
  console.log('[test-setup] Applying schema to', dbUrl)

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
