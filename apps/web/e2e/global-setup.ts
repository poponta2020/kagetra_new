import { execSync } from 'node:child_process'

/**
 * Playwright global setup. Runs once before any spec.
 *
 * Applies the Drizzle schema to the test DB via `drizzle-kit push --force`
 * so the E2E suite is self-sufficient even when Vitest has not run first
 * (e.g. someone runs only `pnpm test:e2e`, or CI runs Vitest and E2E in
 * separate jobs). `--force` is safe because the local `postgres-test`
 * service uses tmpfs and the CI service container is per-job.
 */
async function globalSetup() {
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'
  // eslint-disable-next-line no-console
  console.log('[e2e-setup] Applying schema to', dbUrl)
  execSync(
    'pnpm --filter @kagetra/shared exec drizzle-kit push --force --config=drizzle.config.ts',
    {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, DATABASE_URL: dbUrl },
    },
  )
}

export default globalSetup
