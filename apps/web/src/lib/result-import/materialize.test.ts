import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  matches,
  players,
  tournaments,
  tournamentClasses,
  tournamentParticipants,
  tournamentSeries,
  tournamentSeriesEditions,
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

  it('get-or-create players: same normalized name reuses one player row (affiliation ignored)', async () => {
    // Two classes, same person 田中太郎 (space variant) plays in both → exactly 1 player
    // row. 同定は姓名のみで、所属は無視する。
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

  it('same name, different affiliation → one player (name-only key; raw affiliation kept on participants)', async () => {
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

    // 札幌 / 東京 / null すべて同じ姓名 → player は 1 行に名寄せ。
    const allPlayers = await testDb.select().from(players)
    expect(allPlayers).toHaveLength(1)
    // player 行は所属を持たない（人ではなく「人 × 大会」の属性）。
    expect(allPlayers[0]!.affiliation).toBeNull()

    // participant は 3 行（生スナップショット）。全員が同じ player を指す。
    const allParticipants = await testDb.select().from(tournamentParticipants)
    expect(allParticipants).toHaveLength(3)
    for (const part of allParticipants) {
      expect(part.playerId).toBe(allPlayers[0]!.id)
    }
    // 生の所属は participant 側にロスレスで残る。
    const affs = allParticipants.map((p) => p.affiliation)
    expect(affs).toContain('札幌')
    expect(affs).toContain('東京')
    expect(affs).toContain(null)
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
            affiliation: '札幌', // raw 所属は participant に残る（同定は姓名のみ＝同一 player）
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

  it('same name across classes collapses to one player (name-only key)', async () => {
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

describe('materializeResultDraft — display_name 再計算配線 (Phase 2)', () => {
  // bare な単一名 participant（affiliation=null で全表記揺れが 1 player に名寄せ）。
  function bare(
    seqNo: number,
    name: string,
  ): ParsedResultPayload['classes'][number]['participants'][number] {
    return {
      seqNo,
      name,
      nameKana: null,
      affiliation: null,
      prefecture: null,
      dan: null,
      memberNo: null,
      finalRank: null,
      matches: [],
    }
  }

  // 1 大会を本番同様に「独立した tx」で materialize する（draft 承認ごとに別 tx）。
  async function materializeTournament(opts: {
    name: string
    eventDate: string | null
    classes: { className: string; participants: string[] }[]
  }) {
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: opts.classes.map((c) => ({
        className: c.className,
        grade: null,
        sheetName: null,
        participants: c.participants.map((n, i) => bare(i + 1, n)),
      })),
    }
    return testDb.transaction((tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: opts.name,
        eventDate: opts.eventDate,
        venue: null,
        sourceResultDraftId: 1,
      }),
    )
  }

  it('複数大会を別 tx で materialize → display_name が全期間の最頻表記になる（first-wins を是正）', async () => {
    // 大会1（最初）: 少数派の「山崎」が先に入る → first-wins なら「山崎」固定。
    await materializeTournament({
      name: '大会1',
      eventDate: '2026-01-01',
      classes: [{ className: 'D級', participants: ['山崎'] }],
    })
    // 大会2: 「山﨑」を 2 回。ここまでの全 participation の最頻は「山﨑」。
    await materializeTournament({
      name: '大会2',
      eventDate: '2026-02-01',
      classes: [
        { className: 'D級', participants: ['山﨑'] },
        { className: 'E級', participants: ['山﨑'] },
      ],
    })
    // 大会3: さらに「山﨑」を 1 回（最頻を確定）。
    await materializeTournament({
      name: '大会3',
      eventDate: '2026-03-01',
      classes: [{ className: 'D級', participants: ['山﨑'] }],
    })

    // 山崎/山﨑 は normalizePlayerName で同一キー → player は 1 行に名寄せ。
    const allPlayers = await testDb.select().from(players)
    expect(allPlayers).toHaveLength(1)
    const player = allPlayers[0]!

    // 全 participation の最頻表記「山﨑」が採用されている（first-wins の「山崎」ではない）。
    // 配線が無ければ first-wins のまま「山崎」固定になるケース。
    expect(player.displayName).toBe('山﨑')

    // 生データは各表記のままロスレスで残る（participants.name は不変）。
    // JS デフォルトソートは符号位置順（崎 U+5D0E < 﨑 U+FA11）で「山崎」が先頭。
    const partNames = (await testDb.select().from(tournamentParticipants))
      .map((p) => p.name)
      .sort()
    expect(partNames).toEqual(['山崎', '山﨑', '山﨑', '山﨑'])
  })

  it('単一大会でも touched 経由で recompute が走り display_name がその大会の最頻になる', async () => {
    // 1 大会内に「山崎」1 回・「山﨑」2 回。first-wins(seqNo 順)では「山崎」だが、
    // 末尾 recompute でその大会の最頻「山﨑」へ補正される。
    await materializeTournament({
      name: '単一大会',
      eventDate: '2026-04-01',
      classes: [{ className: 'D級', participants: ['山崎', '山﨑', '山﨑'] }],
    })

    const allPlayers = await testDb.select().from(players)
    expect(allPlayers).toHaveLength(1)
    expect(allPlayers[0]!.displayName).toBe('山﨑')
  })
})

// tournament-entry-rosters flow②: 結果取込時の開催(edition) 自動解決 ───────────
describe('materializeResultDraft — edition 自動解決 (flow②)', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  async function seedSeries(name: string) {
    const [s] = await testDb
      .insert(tournamentSeries)
      .values({ name, kind: 'individual' })
      .returning({ id: tournamentSeries.id })
    return s!.id
  }

  it('系列完全一致＋既存 edition → tournaments.edition_id に解決（新規作成しない）', async () => {
    const seriesId = await seedSeries('こばえちゃ山形酒田大会')
    const [edition] = await testDb
      .insert(tournamentSeriesEditions)
      .values({ seriesId, editionNumber: 28, year: 2026, status: 'held' })
      .returning({ id: tournamentSeriesEditions.id })

    const result = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, buildPayload(), {
        tournamentName: '第28回こばえちゃ山形酒田大会C級',
        eventDate: '2026-05-01',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )
    expect(result.editionId).toBe(edition!.id)
    const t = await testDb.query.tournaments.findFirst({
      where: eq(tournaments.id, result.tournamentId),
    })
    expect(t?.editionId).toBe(edition!.id)
    expect(await testDb.select().from(tournamentSeriesEditions)).toHaveLength(1)
  })

  it('既存 unconfirmed edition(案内由来) → 結果取込で held に昇格する（Codex R2）', async () => {
    const seriesId = await seedSeries('こばえちゃ山形酒田大会')
    const [edition] = await testDb
      .insert(tournamentSeriesEditions)
      .values({ seriesId, editionNumber: 28, year: null, status: 'unconfirmed' })
      .returning({ id: tournamentSeriesEditions.id })

    const result = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, buildPayload(), {
        tournamentName: '第28回こばえちゃ山形酒田大会C級',
        eventDate: '2026-05-01',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )
    expect(result.editionId).toBe(edition!.id)
    const row = await testDb
      .select()
      .from(tournamentSeriesEditions)
      .where(eq(tournamentSeriesEditions.id, edition!.id))
      .limit(1)
    expect(row[0]?.status).toBe('held') // unconfirmed → held に確定
    expect(row[0]?.year).toBe(2026) // year も補完
  })

  it('系列一致＋master に無い回次 → edition を新規作成(status=held)して紐付ける', async () => {
    const seriesId = await seedSeries('こばえちゃ山形酒田大会')
    const result = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, buildPayload(), {
        tournamentName: '第99回こばえちゃ山形酒田大会A級',
        eventDate: '2099-05-01',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )
    const ed = await testDb
      .select()
      .from(tournamentSeriesEditions)
      .where(eq(tournamentSeriesEditions.seriesId, seriesId))
    expect(ed).toHaveLength(1)
    expect(ed[0]?.editionNumber).toBe(99)
    expect(ed[0]?.status).toBe('held')
    expect(ed[0]?.year).toBe(2099)
    expect(result.editionId).toBe(ed[0]!.id)
  })

  it('系列が一致しない → edition_id は null（新規系列は auto 作成しない）', async () => {
    await seedSeries('全く別の大会')
    const result = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, buildPayload(), {
        tournamentName: '第5回どこにもない大会B級',
        eventDate: '2026-05-01',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )
    expect(result.editionId).toBeNull()
    const t = await testDb.query.tournaments.findFirst({
      where: eq(tournaments.id, result.tournamentId),
    })
    expect(t?.editionId).toBeNull()
    // series は増えていない
    expect(await testDb.select().from(tournamentSeries)).toHaveLength(1)
  })

  it('回次が取れない大会名 → edition_id は null', async () => {
    await seedSeries('全日本かるた選手権大会')
    const result = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, buildPayload(), {
        tournamentName: '全日本かるた選手権大会A級', // 第N回 なし
        eventDate: null,
        venue: null,
        sourceResultDraftId: 1,
      }),
    )
    expect(result.editionId).toBeNull()
  })
})

// senseki-stats §4.1: 取込承認時に級内 matches から順位 bracket を事前計算して
// participant.derived_bracket に保存する（順位定義は戦績詳細と単一ソース）。
describe('materializeResultDraft — derived_bracket 書き込み (senseki-stats §4.1)', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  type PMatch = ParsedResultPayload['classes'][number]['participants'][number]['matches'][number]
  function mm(
    round: number,
    roundLabel: string | null,
    opponentName: string | null,
    result: 'win' | 'lose',
    status: 'normal' | 'walkover' | 'forfeit' = 'normal',
  ): PMatch {
    return { round, roundLabel, opponentName, scoreDiff: null, result, status }
  }
  function part(
    name: string,
    finalRank: string | null,
    matches: PMatch[],
  ): ParsedResultPayload['classes'][number]['participants'][number] {
    return {
      seqNo: null,
      name,
      nameKana: null,
      affiliation: null,
      prefecture: null,
      dan: null,
      memberNo: null,
      finalRank,
      matches,
    }
  }

  it('クリーンなシングルイリミ級 → 各 participant に bracket(優勝1/準優勝2/ベスト4) が保存される', async () => {
    // 4人・2回戦（準決勝=R1, 決勝=R2）。優勝者のみ無敗＝敗者3で導出可能。
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'A級',
          grade: 'A',
          sheetName: null,
          participants: [
            part('優勝太郎', '優勝', [
              mm(1, '準決勝', 'ベスト子', 'win'),
              mm(2, '決勝', '準優花子', 'win'),
            ]),
            part('準優花子', '準優勝', [
              mm(1, '準決勝', 'ベスト男', 'win'),
              mm(2, '決勝', '優勝太郎', 'lose'),
            ]),
            part('ベスト子', null, [mm(1, '準決勝', '優勝太郎', 'lose')]),
            part('ベスト男', null, [mm(1, '準決勝', '準優花子', 'lose')]),
          ],
        },
      ],
    }

    const { tournamentId } = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: 'bracket大会',
        eventDate: '2026-06-01',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const classRows = await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, tournamentId))
    const partRows = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.classId, classRows[0]!.id))
    const byName = (n: string) => partRows.find((p) => p.name === n)!

    expect(byName('優勝太郎').derivedBracket).toBe(1)
    expect(byName('準優花子').derivedBracket).toBe(2)
    expect(byName('ベスト子').derivedBracket).toBe(4)
    expect(byName('ベスト男').derivedBracket).toBe(4)
  })

  it('導出不能級（リーグ戦）→ derived_bracket は全 null・final_rank は温存', async () => {
    // 3人総当たり: 敗北3 ≠ 参加者-1(2) → isDerivableClass=false → 全 null。
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'B級',
          grade: 'B',
          sheetName: null,
          participants: [
            part('総当A', '優勝', [
              mm(1, '1回戦', '総当B', 'win'),
              mm(3, '3回戦', '総当C', 'lose'),
            ]),
            part('総当B', '2位', [
              mm(1, '1回戦', '総当A', 'lose'),
              mm(2, '2回戦', '総当C', 'win'),
            ]),
            part('総当C', '3位', [
              mm(2, '2回戦', '総当B', 'lose'),
              mm(3, '3回戦', '総当A', 'win'),
            ]),
          ],
        },
      ],
    }

    const { tournamentId } = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: 'リーグ大会',
        eventDate: '2026-06-02',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const classRows = await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, tournamentId))
    const partRows = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.classId, classRows[0]!.id))

    for (const p of partRows) expect(p.derivedBracket).toBeNull()
    // 導出不能でも生の final_rank は温存される（呼び出し側のフォールバック元）。
    expect(partRows.find((p) => p.name === '総当A')!.finalRank).toBe('優勝')
  })

  it('不戦(walkover/forfeit)を含むクリーンな級も導出される', async () => {
    // 3人: A は1回戦 bye(walkover 勝ち)→決勝勝ち＝優勝、B は1回戦で C に勝ち(C forfeit)
    // →決勝負け＝準優勝、C は1回戦 forfeit 負け＝ベスト4。
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        {
          className: 'C級',
          grade: 'C',
          sheetName: null,
          participants: [
            part('不戦優勝', '優勝', [
              mm(1, null, null, 'win', 'walkover'),
              mm(2, '決勝', '不戦準V', 'win'),
            ]),
            part('不戦準V', '準優勝', [
              mm(1, '1回戦', '不戦棄権', 'win'),
              mm(2, '決勝', '不戦優勝', 'lose'),
            ]),
            part('不戦棄権', null, [mm(1, '1回戦', '不戦準V', 'lose', 'forfeit')]),
          ],
        },
      ],
    }

    const { tournamentId } = await testDb.transaction(async (tx) =>
      materializeResultDraft(tx, payload, {
        tournamentName: '不戦大会',
        eventDate: '2026-06-03',
        venue: null,
        sourceResultDraftId: 1,
      }),
    )

    const classRows = await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, tournamentId))
    const partRows = await testDb
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.classId, classRows[0]!.id))
    const byName = (n: string) => partRows.find((p) => p.name === n)!

    expect(byName('不戦優勝').derivedBracket).toBe(1)
    expect(byName('不戦準V').derivedBracket).toBe(2)
    expect(byName('不戦棄権').derivedBracket).toBe(4)
  })
})
