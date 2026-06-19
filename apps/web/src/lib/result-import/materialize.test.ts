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

  it('相手解決は正規化キーで行う（空白・字体揺れを吸収）', async () => {
    // 参加者は「田中太郎」、相手欄は「田中 太郎」(空白入り)。正規化キーで
    // 解決するので opponentParticipantId が張られる（Codex R3 should_fix）。
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'D級',
          grade: 'D',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '田中太郎',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
            {
              seqNo: 2,
              name: '佐藤花子',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              // raw な相手名は空白入り。正規化すれば「田中太郎」に一致する。
              matches: [
                { round: 1, roundLabel: null, opponentName: '田中 太郎', scoreDiff: 4, result: 'win', status: 'normal' },
              ],
            },
          ],
        },
      ],
    }

    const { tournamentId } = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: '正規化相手大会',
        eventDate: null,
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const classRows = await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, tournamentId))
    const classId = classRows[0]!.id
    const partRows = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.classId, classId))
    const tanaka = partRows.find((p) => p.name === '田中太郎')!
    const sato = partRows.find((p) => p.name === '佐藤花子')!

    const matchRows = await testDb.select().from(matches).where(eq(matches.classId, classId))
    const satoMatch = matchRows.find((m) => m.participantId === sato.id)!
    expect(satoMatch.opponentName).toBe('田中 太郎') // raw は保持
    expect(satoMatch.opponentParticipantId).toBe(tanaka.id) // 正規化で解決
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

  it('同一級内の同姓同名: 各自の試合は自分に紐付き、相手解決は曖昧→null', async () => {
    // 2 人の「田中太郎」が同じ級にいる。それぞれ別の試合を持つ。
    // - 各 participant の試合は「自分」に紐付く（index ベース）
    // - 相手名「田中太郎」は曖昧（2 人いる）なので opponentParticipantId は null
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
            name: '田中太郎',
            nameKana: null,
            affiliation: '札幌', // 別所属 → players は別行
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: null,
            matches: [
              { round: 1, roundLabel: null, opponentName: '佐藤花子', scoreDiff: 2, result: 'win', status: 'normal' },
            ],
          },
          {
            seqNo: 2,
            name: '田中太郎',
            nameKana: null,
            affiliation: '東京',
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: null,
            matches: [
              { round: 1, roundLabel: null, opponentName: '鈴木一郎', scoreDiff: 3, result: 'lose', status: 'normal' },
            ],
          },
          {
            seqNo: 3,
            name: '佐藤花子',
            nameKana: null,
            affiliation: null,
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: null,
            // 相手名が「田中太郎」= 同名2人 → 解決不可で null になるべき
            matches: [
              { round: 1, roundLabel: null, opponentName: '田中太郎', scoreDiff: 2, result: 'lose', status: 'normal' },
            ],
          },
          ],
        },
      ],
    }

    const { tournamentId } = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: '同名大会',
        eventDate: '2026-04-01',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const classRows = await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, tournamentId))
    const classId = classRows[0]!.id

    const partRows = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.classId, classId))
    // 田中太郎×2（別所属）+ 佐藤花子 = 3 participants
    expect(partRows).toHaveLength(3)
    const tanakaSapporo = partRows.find((p) => p.name === '田中太郎' && p.affiliation === '札幌')!
    const tanakaTokyo = partRows.find((p) => p.name === '田中太郎' && p.affiliation === '東京')!
    const sato = partRows.find((p) => p.name === '佐藤花子')!

    const matchRows = await testDb
      .select()
      .from(matches)
      .where(eq(matches.classId, classId))
    expect(matchRows).toHaveLength(3)

    // 札幌田中の試合は札幌田中に紐付く（自分の試合が別同名に化けない）
    const sapporoMatch = matchRows.find((m) => m.participantId === tanakaSapporo.id)!
    expect(sapporoMatch.result).toBe('win')
    expect(sapporoMatch.opponentName).toBe('佐藤花子')
    expect(sapporoMatch.opponentParticipantId).toBe(sato.id)

    // 東京田中の試合は東京田中に紐付く
    const tokyoMatch = matchRows.find((m) => m.participantId === tanakaTokyo.id)!
    expect(tokyoMatch.result).toBe('lose')

    // 佐藤の試合：相手「田中太郎」は2人いて曖昧 → opponentParticipantId は null
    const satoMatch = matchRows.find((m) => m.participantId === sato.id)!
    expect(satoMatch.opponentName).toBe('田中太郎')
    expect(satoMatch.opponentParticipantId).toBeNull()
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
