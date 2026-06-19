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
//
// PR5 added `mail_worker_jobs` (requested_by_user_id ON DELETE CASCADE — would
// disappear with users anyway) and `mail_worker_runs` (triggered_by_user_id
// ON DELETE SET NULL — would survive as orphaned rows). Listing both
// explicitly + RESTART IDENTITY keeps inserted ids deterministic across tests
// and isolates the trigger/run history between specs.
//
// tournament-results added the players/tournaments/result-drafts cluster. CASCADE
// already follows their FKs (e.g. result_drafts via mail_messages), but list each
// explicitly so RESTART IDENTITY resets their identity sequences too.
export async function truncateAll() {
  await testDb.execute(sql`
    TRUNCATE TABLE
      tournament_drafts,
      matches,
      tournament_participants,
      tournament_classes,
      tournaments,
      result_drafts,
      players,
      mail_attachments,
      mail_messages,
      mail_worker_jobs,
      mail_worker_runs,
      line_channels,
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
