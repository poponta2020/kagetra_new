import { resolveTestDatabaseUrl } from '@kagetra/shared/test-db'

/**
 * Vitest per-file setup. Force DATABASE_URL to the (per-worktree) test DB so
 * that any pipeline import (which reaches for `loadConfig()` / `getDb()`)
 * connects to `postgres-test` rather than the developer's dev DB. Tests can
 * still override via vi.stubEnv. TEST_DATABASE_URL is pinned too so nested
 * resolvers land on the same database.
 */
const testDbUrl = resolveTestDatabaseUrl()
process.env.TEST_DATABASE_URL = testDbUrl
process.env.DATABASE_URL = testDbUrl
