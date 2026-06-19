import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  matches,
  players,
  tournaments,
  tournamentClasses,
  tournamentParticipants,
} from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'

// Works for both NodePgDatabase (main db) and NodePgTransaction (inside tx callback).
type DbLike = NodePgDatabase<typeof schema>

export interface MaterializeOpts {
  tournamentName: string
  eventDate: string | null
  venue: string | null
  sourceResultDraftId: number
}

export interface MaterializeResult {
  tournamentId: number
}

/**
 * Materialize a ParsedResultPayload into the tournaments/classes/participants/matches tables.
 * Runs inside the caller's transaction.
 *
 * Player get-or-create is keyed on (normalized_name, affiliation) with NULLS NOT DISTINCT,
 * matching the UNIQUE constraint on `players`. The SELECT-then-INSERT pattern is safe
 * inside a transaction (single-admin operation, no high concurrency).
 *
 * Opponent resolution is done in a second pass over each class's participants, after
 * all participant IDs in that class are known.
 */
export async function materializeResultDraft(
  tx: DbLike,
  payload: ParsedResultPayload,
  opts: MaterializeOpts,
): Promise<MaterializeResult> {
  // 1. Create tournament row.
  const [tournament] = await tx
    .insert(tournaments)
    .values({
      name: opts.tournamentName,
      eventDate: opts.eventDate,
      venue: opts.venue,
      sourceResultDraftId: opts.sourceResultDraftId,
    })
    .returning({ id: tournaments.id })
  const tournamentId = tournament!.id

  // 2. Process each parsed class.
  for (const cls of payload.classes) {
    const [tClass] = await tx
      .insert(tournamentClasses)
      .values({
        tournamentId,
        className: cls.className,
        grade: cls.grade,
        numPlayers: cls.participants.length,
        sheetName: cls.sheetName,
      })
      .returning({ id: tournamentClasses.id })
    const classId = tClass!.id

    // Pass 1: Insert all participants for this class, collecting name→participantId.
    const nameToParticipantId = new Map<string, number>()

    for (const p of cls.participants) {
      // Player get-or-create — normalized key: (normalized_name, affiliation).
      const normalizedName = normalizePlayerName(p.name)
      const normalizedAffiliation = p.affiliation ? normalizePlayerName(p.affiliation) : null

      const existingRows = await tx
        .select({ id: players.id })
        .from(players)
        .where(
          and(
            eq(players.normalizedName, normalizedName),
            normalizedAffiliation === null
              ? isNull(players.affiliation)
              : eq(players.affiliation, normalizedAffiliation),
          ),
        )
        .limit(1)

      let playerId: number
      if (existingRows.length > 0) {
        playerId = existingRows[0]!.id
      } else {
        const [newPlayer] = await tx
          .insert(players)
          .values({
            displayName: p.name,
            normalizedName,
            nameKana: p.nameKana,
            affiliation: p.affiliation,
            prefecture: p.prefecture,
          })
          .returning({ id: players.id })
        playerId = newPlayer!.id
      }

      const [participant] = await tx
        .insert(tournamentParticipants)
        .values({
          classId,
          playerId,
          seqNo: p.seqNo,
          name: p.name,
          nameKana: p.nameKana,
          affiliation: p.affiliation,
          prefecture: p.prefecture,
          dan: p.dan,
          memberNo: p.memberNo,
          finalRank: p.finalRank,
        })
        .returning({ id: tournamentParticipants.id })
      nameToParticipantId.set(p.name, participant!.id)
    }

    // Pass 2: Insert all matches, resolving opponents by name within this class.
    for (const p of cls.participants) {
      const participantId = nameToParticipantId.get(p.name)!
      for (const m of p.matches) {
        const opponentParticipantId =
          m.opponentName != null ? (nameToParticipantId.get(m.opponentName) ?? null) : null

        await tx.insert(matches).values({
          classId,
          round: m.round,
          roundLabel: m.roundLabel,
          participantId,
          opponentParticipantId,
          opponentName: m.opponentName,
          result: m.result,
          scoreDiff: m.scoreDiff,
          status: m.status,
        })
      }
    }
  }

  return { tournamentId }
}
