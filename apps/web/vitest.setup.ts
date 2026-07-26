import { resolveTestDatabaseUrl } from '@kagetra/shared/test-db'

// Force DATABASE_URL to the (per-worktree) test DB so that @/lib/db (top-level
// Pool) connects to the postgres-test container. Tests are destructive
// (TRUNCATE) so this must never point at a dev/prod DB. TEST_DATABASE_URL is
// pinned too so anything re-resolving inside this process (test-utils/db,
// spawned helpers) lands on the same database.
const testDbUrl = resolveTestDatabaseUrl()
process.env.TEST_DATABASE_URL = testDbUrl
process.env.DATABASE_URL = testDbUrl

// LINE link state cookie signing uses AUTH_SECRET. Provide a fixture value
// so `buildLineLinkStateCookie` / `verifyLineLinkStateCookie` work under
// Vitest without requiring the developer's local .env to leak in.
process.env.AUTH_SECRET ??= 'vitest-line-link-state-secret'
