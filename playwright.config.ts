import { defineConfig, devices } from '@playwright/test'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm --filter @kagetra/web dev --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: 'e2e-test-secret-do-not-use-in-production',
      AUTH_LINE_ID: 'e2e-dummy-id',
      AUTH_LINE_SECRET: 'e2e-dummy-secret',
      NEXTAUTH_URL: 'http://localhost:3000',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
