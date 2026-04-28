import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import * as schema from '@kagetra/shared/schema'

/**
 * Direct test-DB pool for mail-worker integration tests.
 *
 * The pipeline implementation reaches for `getDb()` (which reads
 * DATABASE_URL); `vitest.setup.ts` sets `process.env.DATABASE_URL =
 * TEST_DATABASE_URL` before any test runs so both pools target the same test
 * container. We expose `testDb` separately so assertions can run SELECTs
 * without going through the pipeline's db handle.
 *
 * No env mutation in this module: keeping side effects out of `import` order
 * means test files can import in any order without surprises.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'

const testPool = new Pool({ connectionString: TEST_DATABASE_URL })
export const testDb = drizzle(testPool, { schema })

export async function truncateMailTables() {
  // Single statement; CASCADE pulls `mail_attachments` AND `tournament_drafts`
  // (PR3) along through the FK, and RESTART IDENTITY applies to the cascaded
  // tables too. The plural function name reflects that scope: any table whose
  // PK chains to `mail_messages.id` is wiped here.
  await testDb.execute(sql`TRUNCATE TABLE mail_messages RESTART IDENTITY CASCADE`)
}

/**
 * PR5 Phase 3: clear `mail_worker_runs` + `mail_worker_jobs` between tests
 * that exercise the dispatcher / runOnce. Separate from `truncateMailTables`
 * because some tests (e.g. classifier-only) don't need to touch the runs
 * tables and a wider TRUNCATE would slow them down.
 *
 * `mail_worker_jobs` references `mail_worker_runs.id`, so we truncate the
 * jobs table first (or rely on CASCADE). RESTART IDENTITY keeps assertions
 * that compare against `runId === 1` deterministic across runs.
 */
export async function truncateMailWorkerTables() {
  await testDb.execute(
    sql`TRUNCATE TABLE mail_worker_jobs, mail_worker_runs RESTART IDENTITY CASCADE`,
  )
}

export async function closeTestDb() {
  await testPool.end()
}
