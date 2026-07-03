// One-off: recompute ALL players' display_name (mode of raw participations)
// after dedup/cleanup, reusing the app's exact logic. Idempotent backfill.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import * as mod from './src/lib/players/recompute-display-name.ts'
const recompute = ((mod as { default?: typeof mod }).default ?? mod).recomputePlayerDisplayNames
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })
const n = await recompute(db as never)
console.log('recomputed display_name for', n, 'players')
await pool.end()
