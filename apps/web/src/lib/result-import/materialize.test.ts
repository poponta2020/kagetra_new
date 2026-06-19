import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  matches,
  players,
  tournaments,
  tournamentClasses,
  tournamentParticipants,
} from '@kagetra/shared/schema'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from './materialize'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

function buildPayload(): ParsedResultPayload {
  // D1 級: 田中 vs 佐藤 (normal match, both views), plus 鈴木 (walkover) and
  // 高橋 with a forfeit loss.
  return {
    parserVersion: '1.0.0',
    classes: [
      {
        className: 'D1級',
        grade: 'D',
        sheetName: '対戦結果表_D1級',
        participants: [
          {
            seqNo: 1,
            name: '田中太郎',
            nameKana: 'タナカタロウ',
            affiliation: '札幌',
            prefecture: '北海道',
            dan: '初段',
            memberNo: null,
            finalRank: '優勝',
            matches: [
              {
                round: 1,
                roundLabel: '1回戦',
                opponentName: '佐藤花子',
                scoreDiff: 5,
                result: 'win',
                status: 'normal',
              },
            ],
          },
          {
            seqNo: 2,
            name: '佐藤花子',
            nameKana: 'サトウハナコ',
            affiliation: '東京',
            prefecture: '東京都',
            dan: '弐段',
            memberNo: null,
            finalRank: '準優勝',
            matches: [
              {
                round: 1,
                roundLabel: '1回戦',
                opponentName: '田中太郎',
                scoreDiff: 5,
                result: 'lose',
                status: 'normal',
              },
            ],
          },
          {
            seqNo: 3,
            name: '鈴木一郎',
            nameKana: null,
            affiliation: null,
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: null,
            matches: [
              {
                round: 2,
                roundLabel: '2回戦',
                opponentName: null,
                scoreDiff: null,
                result: 'win',
                status: 'walkover',
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('materializeResultDraft', () => {
  it('creates tournament/class/participants/matches and resolves opponents', async () => {
    const result = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, buildPayload(), {
        tournamentName: 'テスト大会',
        eventDate: '2026-05-01',
        venue: '札幌市民会館',
        sourceResultDraftId: 1,
      }),
    )

    const t = await testDb.query.tournaments.findFirst({
      where: eq(tournaments.id, result.tournamentId),
    })
    expect(t?.name).toBe('テスト大会')
    expect(t?.eventDate).toBe('2026-05-01')
    expect(t?.venue).toBe('札幌市民会館')
    expect(t?.sourceResultDraftId).toBe(1)

    const classRows = await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, result.tournamentId))
    expect(classRows).toHaveLength(1)
    expect(classRows[0]!.className).toBe('D1級')
    expect(classRows[0]!.grade).toBe('D')
    expect(classRows[0]!.numPlayers).toBe(3)

    const classId = classRows[0]!.id
    const partRows = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.classId, classId))
    expect(partRows).toHaveLength(3)

    const tanaka = partRows.find((p) => p.name === '田中太郎')!
    const sato = partRows.find((p) => p.name === '佐藤花子')!
    expect(tanaka.finalRank).toBe('優勝')
    expect(tanaka.playerId).not.toBeNull()

    // Match rows: 1 (tanaka win) + 1 (sato lose) + 1 (suzuki walkover) = 3
    const matchRows = await testDb
      .select()
      .from(matches)
      .where(eq(matches.classId, classId))
    expect(matchRows).toHaveLength(3)

    // Tanaka's match should resolve opponent to Sato's participant id.
    const tanakaMatch = matchRows.find((m) => m.participantId === tanaka.id)!
    expect(tanakaMatch.opponentParticipantId).toBe(sato.id)
    expect(tanakaMatch.opponentName).toBe('佐藤花子')
    expect(tanakaMatch.result).toBe('win')
    expect(tanakaMatch.status).toBe('normal')

    // Walkover match: opponentName null, opponentParticipantId null, score null.
    const suzuki = partRows.find((p) => p.name === '鈴木一郎')!
    const walkoverMatch = matchRows.find((m) => m.participantId === suzuki.id)!
    expect(walkoverMatch.status).toBe('walkover')
    expect(walkoverMatch.opponentParticipantId).toBeNull()
    expect(walkoverMatch.opponentName).toBeNull()
    expect(walkoverMatch.scoreDiff).toBeNull()
  })

  it('get-or-create players: same (normalized_name, affiliation) reuses one player row', async () => {
    // Two classes, same person 田中太郎/札幌 plays in both → exactly 1 player row.
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'A級',
          grade: 'A',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '田中 太郎', // note the space — normalized away
              nameKana: null,
              affiliation: '札幌',
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ],
        },
        {
          className: 'B級',
          grade: 'B',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '田中太郎', // no space
              nameKana: null,
              affiliation: '札幌',
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ],
        },
      ],
    }

    await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: 'dedup大会',
        eventDate: null,
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const allPlayers = await testDb.select().from(players)
    expect(allPlayers).toHaveLength(1)
    expect(allPlayers[0]!.normalizedName).toBe('田中太郎')

    // But both participants exist (生スナップショット), each pointing to that player.
    const allParticipants = await testDb.select().from(tournamentParticipants)
    expect(allParticipants).toHaveLength(2)
    expect(allParticipants[0]!.playerId).toBe(allPlayers[0]!.id)
    expect(allParticipants[1]!.playerId).toBe(allPlayers[0]!.id)
  })

  it('different affiliation → different players (NULLS NOT DISTINCT only collapses null)', async () => {
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'A級',
          grade: 'A',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '山田一郎',
              nameKana: null,
              affiliation: '札幌',
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
            {
              seqNo: 2,
              name: '山田一郎',
              nameKana: null,
              affiliation: '東京', // same name, different affiliation
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
            {
              seqNo: 3,
              name: '山田一郎',
              nameKana: null,
              affiliation: null, // null affiliation
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ],
        },
      ],
    }

    await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: 'affiliation大会',
        eventDate: null,
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    // 札幌 / 東京 / null → 3 distinct players.
    const allPlayers = await testDb.select().from(players)
    expect(allPlayers).toHaveLength(3)
  })

  it('null-affiliation same name across classes collapses to one player (NULLS NOT DISTINCT)', async () => {
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'A級',
          grade: 'A',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '無所属太郎',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ],
        },
        {
          className: 'B級',
          grade: 'B',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '無所属太郎',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ],
        },
      ],
    }

    await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: 'null所属大会',
        eventDate: null,
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const allPlayers = await testDb.select().from(players)
    expect(allPlayers).toHaveLength(1)
  })
})
