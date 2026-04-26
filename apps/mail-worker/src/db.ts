import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import * as schema from '@kagetra/shared/schema'
import { loadDbConfig } from './config.js'

/**
 * Lazy Drizzle client. Mirrors the `apps/web/src/lib/db.ts` pattern but only
 * builds a Pool when actually used, so tests that stub the env (or run with
 * `--mock-imap` + `--dry-run`) don't open an unnecessary connection. The
 * `DATABASE_URL` env requirement is enforced here (via `loadDbConfig`) rather
 * than in module-level config so dry-run smoke paths stay viable without DB.
 */
let pool: Pool | null = null

export type DbClient = NodePgDatabase<typeof schema>
export type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>
/**
 * Either the top-level pool client or a per-mail transaction handle. Both
 * carry the same `insert / update / select / query` surface, so persisters
 * accept either and the pipeline can wrap a parent + attachments into one
 * atomic unit (see `runPipeline` in `pipeline.ts`).
 */
export type Db = DbClient | DbTransaction
let cachedDb: DbClient | null = null

export function getDb(): DbClient {
  if (cachedDb) return cachedDb
  const config = loadDbConfig()
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
