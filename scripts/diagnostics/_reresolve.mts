// One-off: apply name/affiliation corrections to existing participants and
// re-resolve their player (get-or-create by normalized姓名), cleaning orphaned
// players and recomputing display_name — reusing the app's exact logic.
//
// Input: c:/tmp/_corrections.jsonl, one JSON per line:
//   { "pid": <participant id>, "name": "<corrected raw name>",
//     "affiliation": "<corrected raw affiliation>"|null  (optional; omit = keep) }
//
// Usage (from apps/web):
//   DATABASE_URL=postgresql://kagetra:kagetra_dev@localhost:5433/kagetra_rehearsal \
//     pnpm --filter @kagetra/mail-worker exec tsx ../web/_reresolve.mts
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kagetra/shared/schema'
import { players, tournamentParticipants } from '@kagetra/shared/schema'
import { readFileSync } from 'node:fs'
import * as normMod from '@kagetra/mail-worker/result-import/normalize'
const normalizePlayerName = (
  (normMod as { default?: typeof normMod }).default ?? normMod
).normalizePlayerName
import * as recMod from './src/lib/players/recompute-display-name.ts'
const recomputePlayerDisplayNames = (
  (recMod as { default?: typeof recMod }).default ?? recMod
).recomputePlayerDisplayNames

type Corr = { pid: number; name: string; affiliation?: string | null }

const path = process.env.CORR_FILE ?? 'c:/tmp/_corrections.jsonl'
const corrections: Corr[] = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })

const idArr = (ids: number[]) => sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[]`

let applied = 0
let missing = 0
await db.transaction(async (tx) => {
  const touched = new Set<number>()
  const oldPlayers = new Set<number>()

  for (const c of corrections) {
    const cur = await tx
      .select({ oldPlayer: tournamentParticipants.playerId })
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.id, c.pid))
      .limit(1)
    if (cur.length === 0) {
      missing++
      console.log('MISSING pid', c.pid)
      continue
    }
    if (cur[0]!.oldPlayer != null) oldPlayers.add(cur[0]!.oldPlayer)

    const normalizedName = normalizePlayerName(c.name)
    let playerId: number
    const ex = await tx
      .select({ id: players.id })
      .from(players)
      .where(eq(players.normalizedName, normalizedName))
      .limit(1)
    if (ex.length > 0) playerId = ex[0]!.id
    else {
      const ins = await tx
        .insert(players)
        .values({ displayName: c.name, normalizedName, nameKana: null, affiliation: null, prefecture: null })
        .onConflictDoNothing()
        .returning({ id: players.id })
      if (ins.length > 0) playerId = ins[0]!.id
      else {
        const re = await tx
          .select({ id: players.id })
          .from(players)
          .where(eq(players.normalizedName, normalizedName))
          .limit(1)
        playerId = re[0]!.id
      }
    }
    touched.add(playerId)

    const setVals: Record<string, unknown> = { name: c.name, playerId }
    if (Object.prototype.hasOwnProperty.call(c, 'affiliation')) setVals.affiliation = c.affiliation ?? null
    await tx.update(tournamentParticipants).set(setVals).where(eq(tournamentParticipants.id, c.pid))
    applied++
  }

  // orphan cleanup: previously-referenced players that now have 0 participants
  let orphanIds: number[] = []
  if (oldPlayers.size > 0) {
    const res = await tx.execute(
      sql`SELECT id FROM players WHERE id = ANY(${idArr([...oldPlayers])}) AND NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id = players.id)`,
    )
    orphanIds = (res.rows as { id: number }[]).map((r) => r.id)
    if (orphanIds.length > 0) await tx.execute(sql`DELETE FROM players WHERE id = ANY(${idArr(orphanIds)})`)
  }

  const keptOld = [...oldPlayers].filter((id) => !orphanIds.includes(id))
  const recomputeSet = [...new Set([...touched, ...keptOld])]
  const recomputed = await recomputePlayerDisplayNames(tx as never, recomputeSet)

  console.log(
    `applied=${applied} missing=${missing} touched_players=${touched.size} orphans_deleted=${orphanIds.length} display_recomputed=${recomputed}`,
  )
})
await pool.end()
