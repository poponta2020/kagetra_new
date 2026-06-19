import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  users,
  mailMessages,
  players,
  tournaments,
  tournamentClasses,
  tournamentParticipants,
  matches,
  resultDrafts,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser, createMailMessage } from '@/test-utils/seed'

// DB-backed verification of the tournament-results schema FK behaviour.
//
// The test DB schema is applied via `drizzle-kit push --force` (vitest global
// setup), so ONLY the FKs declared in the drizzle schema exist here. The two
// raw-ALTER FKs (tournaments.source_result_draft_id and
// result_drafts.superseded_by_draft_id) are NOT pushed and are validated
// separately by applying migration 0026 to a scratch DB — do not assert them
// here.

async function insertPlayer(overrides: Partial<typeof players.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(players)
    .values({
      displayName: '山田太郎',
      normalizedName: `yamada-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  if (!row) throw new Error('failed to insert player')
  return row
}

async function insertTournament(overrides: Partial<typeof tournaments.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(tournaments)
    .values({ name: '第10回 全国大会', ...overrides })
    .returning()
  if (!row) throw new Error('failed to insert tournament')
  return row
}

async function insertClass(tournamentId: number, overrides: Partial<typeof tournamentClasses.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(tournamentClasses)
    .values({ tournamentId, className: 'A級', grade: 'A', ...overrides })
    .returning()
  if (!row) throw new Error('failed to insert class')
  return row
}

async function insertParticipant(
  classId: number,
  overrides: Partial<typeof tournamentParticipants.$inferInsert> = {},
) {
  const [row] = await testDb
    .insert(tournamentParticipants)
    .values({ classId, name: '山田太郎', ...overrides })
    .returning()
  if (!row) throw new Error('failed to insert participant')
  return row
}

describe('tournament-results schema (DB-backed FK/cascade)', () => {
  beforeEach(truncateAll)
  afterAll(closeTestDb)

  it('deleting a tournament cascades to classes, participants and matches', async () => {
    const t = await insertTournament()
    const c = await insertClass(t.id)
    const p1 = await insertParticipant(c.id, { name: '選手1' })
    const p2 = await insertParticipant(c.id, { name: '選手2' })
    await testDb.insert(matches).values({
      classId: c.id,
      round: 1,
      participantId: p1.id,
      opponentParticipantId: p2.id,
      opponentName: '選手2',
      result: 'win',
      scoreDiff: 5,
      status: 'normal',
    })

    await testDb.delete(tournaments).where(eq(tournaments.id, t.id))

    expect(await testDb.select().from(tournamentClasses)).toHaveLength(0)
    expect(await testDb.select().from(tournamentParticipants)).toHaveLength(0)
    expect(await testDb.select().from(matches)).toHaveLength(0)
  })

  it('deleting a player sets participant.player_id to NULL (snapshot survives)', async () => {
    const player = await insertPlayer()
    const t = await insertTournament()
    const c = await insertClass(t.id)
    const p = await insertParticipant(c.id, { playerId: player.id })

    await testDb.delete(players).where(eq(players.id, player.id))

    const [after] = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.id, p.id))
    expect(after).toBeDefined()
    expect(after?.playerId).toBeNull()
  })

  it('deleting a user sets players.user_id to NULL (player survives)', async () => {
    const user = await createUser()
    const player = await insertPlayer({ userId: user.id })

    await testDb.delete(users).where(eq(users.id, user.id))

    const [after] = await testDb.select().from(players).where(eq(players.id, player.id))
    expect(after).toBeDefined()
    expect(after?.userId).toBeNull()
  })

  it('deleting a mail message cascades to its result_draft', async () => {
    const mail = await createMailMessage()
    await testDb
      .insert(resultDrafts)
      .values({ messageId: mail.id, parserVersion: 'test-1.0' })

    await testDb.delete(mailMessages).where(eq(mailMessages.id, mail.id))

    expect(await testDb.select().from(resultDrafts)).toHaveLength(0)
  })

  it('deleting the tournament a draft points to sets result_draft.tournament_id NULL', async () => {
    const mail = await createMailMessage()
    const t = await insertTournament()
    const [draft] = await testDb
      .insert(resultDrafts)
      .values({ messageId: mail.id, parserVersion: 'test-1.0', tournamentId: t.id })
      .returning()

    await testDb.delete(tournaments).where(eq(tournaments.id, t.id))

    const [after] = await testDb
      .select()
      .from(resultDrafts)
      .where(eq(resultDrafts.id, draft!.id))
    expect(after).toBeDefined()
    expect(after?.tournamentId).toBeNull()
  })

  it('UNIQUE(normalized_name, affiliation) is NULLS NOT DISTINCT (null-affiliation dedupes)', async () => {
    await insertPlayer({ normalizedName: 'tanaka', affiliation: null })
    // Same normalized name + null affiliation must collide (NULLS NOT DISTINCT),
    // otherwise Task 4 get-or-create would create duplicate players.
    await expect(
      insertPlayer({ normalizedName: 'tanaka', affiliation: null }),
    ).rejects.toThrow()
    // Different affiliation is a distinct player (no collision).
    await insertPlayer({ normalizedName: 'tanaka', affiliation: '札幌かるた会' })
    expect(await testDb.select().from(players)).toHaveLength(2)
  })

  it('participant.dan is free text (accepts non-numeric ranks)', async () => {
    const t = await insertTournament()
    const c = await insertClass(t.id)
    const p = await insertParticipant(c.id, { dan: '五段', memberNo: 'A-123', finalRank: '優勝' })
    const [after] = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.id, p.id))
    expect(after?.dan).toBe('五段')
    expect(after?.memberNo).toBe('A-123')
    expect(after?.finalRank).toBe('優勝')
  })

  it('composite FK rejects a match whose class_id differs from the participant class', async () => {
    const t = await insertTournament()
    const classA = await insertClass(t.id, { className: 'A級' })
    const classB = await insertClass(t.id, { className: 'B級' })
    const pInA = await insertParticipant(classA.id, { name: 'A級選手' })
    // class_id=B but participant belongs to A → (participant_id, class_id) composite FK
    // has no matching (id, class_id) row, so the insert must fail. Guards against a
    // materialize bug attributing a match to the wrong class.
    await expect(
      testDb.insert(matches).values({
        classId: classB.id,
        round: 1,
        participantId: pInA.id,
        result: 'win',
        status: 'normal',
      }),
    ).rejects.toThrow()
    // Same participant + its own class succeeds.
    await testDb.insert(matches).values({
      classId: classA.id,
      round: 1,
      participantId: pInA.id,
      result: 'win',
      status: 'normal',
    })
    expect(await testDb.select().from(matches)).toHaveLength(1)
  })
})
