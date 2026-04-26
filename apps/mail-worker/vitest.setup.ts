/**
 * Vitest per-file setup. Force DATABASE_URL to the test DB so that any
 * pipeline import (which reaches for `loadConfig()` / `getDb()`) connects to
 * `postgres-test` rather than the developer's dev DB. Tests can still
 * override via vi.stubEnv.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'
