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

    // Pass 1: Insert all participants for this class.
    //
    // Each participant's id is tracked by ARRAY INDEX (participantIds[i]), NOT
    // by name, so two same-name participants in one class don't clobber each
    // other (Codex R1 blocker: a name-keyed map made a player's own matches
    // attach to the last同名 participant). The name→ids[] map is kept ONLY for
    // opponent resolution, where an ambiguous (>1) or unknown name resolves to
    // null — opponent_name stays as the soft textual reference.
    const participantIds: number[] = new Array(cls.participants.length)
    const nameToIds = new Map<string, number[]>()

    for (let i = 0; i < cls.participants.length; i++) {
      const p = cls.participants[i]!
      // Player get-or-create — normalized key: (normalized_name, affiliation).
      const normalizedName = normalizePlayerName(p.name)
      // players is the grouping layer: the affiliation is normalized for BOTH
      // the lookup and the stored value so they match the (normalized_name,
      // affiliation) UNIQUE key (Codex R1 should_fix: looking up normalized but
      // storing raw missed existing rows → UNIQUE violation). The raw
      // affiliation is preserved on the participant snapshot below.
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
            // store the normalized affiliation so it matches the lookup/UNIQUE key
            affiliation: normalizedAffiliation,
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
          // raw affiliation snapshot stays on the participant (生データが常に正)
          affiliation: p.affiliation,
          prefecture: p.prefecture,
          dan: p.dan,
          memberNo: p.memberNo,
          finalRank: p.finalRank,
        })
        .returning({ id: tournamentParticipants.id })
      participantIds[i] = participant!.id
      const ids = nameToIds.get(p.name)
      if (ids) ids.push(participant!.id)
      else nameToIds.set(p.name, [participant!.id])
    }

    // Pass 2: Insert all matches. The participant's OWN id comes from the index
    // (unambiguous); the opponent is resolved by name only when that name is
    // unique within the class.
    for (let i = 0; i < cls.participants.length; i++) {
      const p = cls.participants[i]!
      const participantId = participantIds[i]!
      for (const m of p.matches) {
        let opponentParticipantId: number | null = null
        if (m.opponentName != null) {
          const ids = nameToIds.get(m.opponentName)
          // Only resolve when exactly one participant carries that name;
          // duplicates (>1) or unknown → null (ambiguity made explicit).
          if (ids && ids.length === 1) opponentParticipantId = ids[0]!
        }

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
