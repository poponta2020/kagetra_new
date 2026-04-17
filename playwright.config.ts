import { defineConfig, devices } from '@playwright/test'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'

// Dedicated E2E port (dev uses 3000). This keeps Playwright isolated from any
// running `pnpm dev:web` so we never reuse a server whose webServer.env was
// never applied — otherwise tests seed into the test DB while the reused
// server points at the dev DB, causing flakes and cross-writes.
const E2E_PORT = 3001
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm --filter @kagetra/web dev --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // Always spawn a fresh server so webServer.env (test DB, test secrets)
    // is guaranteed to apply. Reusing a stray server would silently target
    // the wrong DB.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: 'e2e-test-secret-do-not-use-in-production',
      AUTH_LINE_ID: 'e2e-dummy-id',
      AUTH_LINE_SECRET: 'e2e-dummy-secret',
      NEXTAUTH_URL: E2E_BASE_URL,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
