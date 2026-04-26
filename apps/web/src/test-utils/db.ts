import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import * as schema from '@kagetra/shared/schema'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'

const testPool = new Pool({ connectionString: TEST_DATABASE_URL })
export const testDb = drizzle(testPool, { schema })

// TRUNCATE all tables (CASCADE to handle FK). Call in beforeEach.
// Table names match pgTable(...) first arg in packages/shared/src/schema/*.ts.
export async function truncateAll() {
  await testDb.execute(sql`
    TRUNCATE TABLE
      tournament_drafts,
      mail_attachments,
      mail_messages,
      event_attendances,
      schedule_items,
      events,
      event_groups,
      sessions,
      accounts,
      verification_tokens,
      users
    RESTART IDENTITY CASCADE
  `)
}

export async function closeTestDb() {
  await testPool.end()
}
