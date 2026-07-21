import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { players, tournamentEntryRosterEntries, users } from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'

type DbLike = NodePgDatabase<typeof schema>

/** null means the normalized name is ambiguous; a missing key means no member matched. */
export type UniqueMemberNameMap = ReadonlyMap<string, string | null>

export async function loadUniqueMemberNameMap(db: DbLike): Promise<UniqueMemberNameMap> {
  const memberRows = await db.select({ id: users.id, name: users.name }).from(users)
  const memberByName = new Map<string, string | null>()

  for (const member of memberRows) {
    if (!member.name) continue
    const normalizedName = normalizePlayerName(member.name)
    if (!normalizedName) continue
    memberByName.set(normalizedName, memberByName.has(normalizedName) ? null : member.id)
  }

  return memberByName
}

export function resolveUniqueMemberId(
  memberByName: UniqueMemberNameMap,
  normalizedName: string,
): string | null {
  return memberByName.get(normalizedName) ?? null
}

/** Keep players.user_id aligned with the same exact, unique normalized-name rule as roster rows. */
export async function syncPlayerMemberLink(
  db: DbLike,
  playerId: number,
  normalizedName: string,
  memberByName: UniqueMemberNameMap,
): Promise<string | null> {
  const userId = resolveUniqueMemberId(memberByName, normalizedName)
  await db
    .update(players)
    .set({ userId, updatedAt: new Date() })
    .where(eq(players.id, playerId))
  await db
    .update(tournamentEntryRosterEntries)
    .set({ userId, updatedAt: new Date() })
    .where(eq(tournamentEntryRosterEntries.playerId, playerId))
  return userId
}

/** Backfill all players, or an explicit subset, without guessing from affiliation or other fields. */
export async function syncPlayersToUniqueMembers(
  db: DbLike,
  playerIds?: number[],
  existingMemberMap?: UniqueMemberNameMap,
): Promise<{ linked: number; unlinked: number }> {
  if (playerIds !== undefined && playerIds.length === 0) return { linked: 0, unlinked: 0 }

  const memberByName = existingMemberMap ?? (await loadUniqueMemberNameMap(db))
  const query = db
    .select({ id: players.id, normalizedName: players.normalizedName })
    .from(players)
  const playerRows =
    playerIds === undefined ? await query : await query.where(inArray(players.id, playerIds))

  let linked = 0
  let unlinked = 0
  for (const player of playerRows) {
    const userId = await syncPlayerMemberLink(
      db,
      player.id,
      player.normalizedName,
      memberByName,
    )
    if (userId) linked++
    else unlinked++
  }

  return { linked, unlinked }
}
