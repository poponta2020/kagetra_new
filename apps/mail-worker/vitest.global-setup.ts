import { execSync } from 'node:child_process'

/**
 * Vitest global setup. Pushes the current Drizzle schema to the test DB once
 * before any test file. Mirrors apps/web/vitest.global-setup.ts so we can
 * rely on `mail_messages` existing without needing an explicit migration step
 * in CI.
 */
export default async function setup() {
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'

  // eslint-disable-next-line no-console
  console.log('[mail-worker test-setup] Applying schema to', dbUrl)

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
