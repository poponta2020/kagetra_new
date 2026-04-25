import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '@kagetra/shared/schema'
import { loadConfig } from './config.js'

/**
 * Lazy Drizzle client. Mirrors the `apps/web/src/lib/db.ts` pattern but only
 * builds a Pool when actually used, so tests that stub the env (or run with
 * `--mock-imap` + `--dry-run`) don't open an unnecessary connection.
 */
let pool: Pool | null = null

type Db = ReturnType<typeof drizzle<typeof schema>>
let cachedDb: Db | null = null

export function getDb(): Db {
  if (cachedDb) return cachedDb
  const config = loadConfig()
  pool = new Pool({ connectionString: config.DATABASE_URL })
  cachedDb = drizzle(pool, { schema })
  return cachedDb
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    cachedDb = null
  }
}

export { schema }
