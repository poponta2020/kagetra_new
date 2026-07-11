// One-off: load hand-built recovery entries from c:/tmp/_add.jsonl into DB via materialize.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import * as materializeMod from './src/lib/result-import/materialize.ts'
const materializeResultDraft = ((materializeMod as { default?: typeof materializeMod }).default ?? materializeMod).materializeResultDraft
import { readFileSync } from 'node:fs'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })
const ADD_FILE = process.env.ADD_FILE || 'c:/tmp/_add.jsonl'
let ok = 0
for (const line of readFileSync(ADD_FILE, 'utf8').split('\n').filter(Boolean)) {
  const rec = JSON.parse(line)
  const parts = rec.classes.reduce((a: number, c: { participants: unknown[] }) => a + c.participants.length, 0)
  try {
    await db.transaction(async (tx) => {
      await materializeResultDraft(tx as never, { parserVersion: 'manual-1.0.0', classes: rec.classes }, { tournamentName: rec.name, eventDate: rec.date, venue: null, sourceResultDraftId: null as never })
    })
    ok++; console.log(`loaded "${rec.name}" (${rec.date}) parts=${parts}`)
  } catch (e) { console.log('FAIL', rec.name, e instanceof Error ? ((e as { cause?: { message?: string } }).cause?.message ?? e.message) : String(e)) }
}
console.log('DONE ok=' + ok)
await pool.end()
