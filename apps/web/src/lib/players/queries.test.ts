import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getPlayerRecord, searchPlayers } from './queries'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

/**
 * Seed a tournament via materializeResultDraft (the real materialize path) so
 * the queries are exercised against rows shaped exactly like production.
 */
async function seedTournament(payload: ParsedResultPayload, opts: {
  name: string
  eventDate: string | null
}) {
  return testDb.transaction(async (tx) =>
    materializeResultDraft(tx, payload, {
      tournamentName: opts.name,
      eventDate: opts.eventDate,
      venue: null,
      sourceResultDraftId: 1,
    }),
  )
}

function classWith(
  className: string,
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null,
  participants: ParsedResultPayload['classes'][number]['participants'],
): ParsedResultPayload['classes'][number] {
  return { className, grade, sheetName: null, participants }
}

describe('searchPlayers', () => {
  it('正規化して部分一致で選手を引く（空白違いも吸収）', async () => {
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [
          classWith('D級', 'D', [
            {
              seqNo: 1,
              name: '山田太郎',
              nameKana: null,
              affiliation: '札幌',
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ]),
        ],
      },
      { name: '大会1', eventDate: '2026-01-01' },
    )

    // 空白を含む検索語でもヒットする（normalizePlayerName で空白除去）。
    const results = await searchPlayers('山田 太郎')
    expect(results).toHaveLength(1)
    expect(results[0]!.displayName).toBe('山田太郎')
    // player は所属を持たない（同定は姓名のみ・所属は per-大会）。
    expect(results[0]!.affiliation).toBeNull()
    expect(results[0]!.participationCount).toBe(1)
  })

  it('部分一致（姓だけ）でも引ける', async () => {
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [
          classWith('D級', 'D', [
            {
              seqNo: 1,
              name: '佐藤花子',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ]),
        ],
      },
      { name: '大会1', eventDate: '2026-01-01' },
    )

    const results = await searchPlayers('佐藤')
    expect(results).toHaveLength(1)
    expect(results[0]!.displayName).toBe('佐藤花子')
  })

  it('空クエリは空配列を返す', async () => {
    expect(await searchPlayers('')).toEqual([])
    expect(await searchPlayers('   ')).toEqual([])
  })

  it('一致しない場合は空配列', async () => {
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [
          classWith('D級', 'D', [
            {
              seqNo: 1,
              name: '田中一郎',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ]),
        ],
      },
      { name: '大会1', eventDate: '2026-01-01' },
    )
    expect(await searchPlayers('鈴木')).toEqual([])
  })
})

describe('getPlayerRecord', () => {
  it('全出場と試合を返し、勝敗は status=normal のみ集計する', async () => {
    // 田中: normal win(対佐藤) + normal lose(対鈴木) + walkover win + forfeit win
    //   → 通算 1勝1敗（walkover/forfeit は除外）
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        classWith('D1級', 'D', [
          {
            seqNo: 1,
            name: '田中太郎',
            nameKana: null,
            affiliation: '札幌',
            prefecture: '北海道',
            dan: null,
            memberNo: null,
            finalRank: '優勝',
            matches: [
              { round: 1, roundLabel: '1回戦', opponentName: '佐藤花子', scoreDiff: 5, result: 'win', status: 'normal' },
              { round: 2, roundLabel: '2回戦', opponentName: '鈴木一郎', scoreDiff: 3, result: 'lose', status: 'normal' },
              { round: 3, roundLabel: '3回戦', opponentName: null, scoreDiff: null, result: 'win', status: 'walkover' },
              { round: 4, roundLabel: '4回戦', opponentName: '高橋次郎', scoreDiff: null, result: 'win', status: 'forfeit' },
            ],
          },
          {
            seqNo: 2,
            name: '佐藤花子',
            nameKana: null,
            affiliation: '東京',
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: '準優勝',
            matches: [
              { round: 1, roundLabel: '1回戦', opponentName: '田中太郎', scoreDiff: 5, result: 'lose', status: 'normal' },
            ],
          },
        ]),
      ],
    }
    await seedTournament(payload, { name: '春季大会', eventDate: '2026-03-01' })

    // 田中の player_id を取得
    const tanaka = (await searchPlayers('田中太郎'))[0]!
    const record = await getPlayerRecord(tanaka.id)
    expect(record).not.toBeNull()
    expect(record!.player.displayName).toBe('田中太郎')
    // player 行は所属を持たない（常に null）。所属は participation 側に出る。
    expect(record!.player.affiliation).toBeNull()

    // 通算は status=normal のみ：1勝1敗
    expect(record!.totalWins).toBe(1)
    expect(record!.totalLosses).toBe(1)

    // 出場は1大会、4試合（全 status 表示）
    expect(record!.participations).toHaveLength(1)
    const part = record!.participations[0]!
    expect(part.tournamentName).toBe('春季大会')
    expect(part.eventDate).toBe('2026-03-01')
    expect(part.className).toBe('D1級')
    expect(part.grade).toBe('D')
    expect(part.affiliation).toBe('札幌') // その大会での所属（生スナップショット）
    expect(part.finalRank).toBe('優勝')
    expect(part.matches).toHaveLength(4)
    // round 昇順
    expect(part.matches.map((m) => m.round)).toEqual([1, 2, 3, 4])
    // walkover は相手なし
    expect(part.matches[2]!.status).toBe('walkover')
    expect(part.matches[2]!.opponentName).toBeNull()
  })

  it('複数大会出場を開催日降順で返す', async () => {
    const mk = (name: string): ParsedResultPayload => ({
      parserVersion: '1.0.0',
      classes: [
        classWith('A級', 'A', [
          {
            seqNo: 1,
            name: '名人太郎',
            nameKana: null,
            affiliation: '全国',
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: null,
            matches: [],
          },
        ]),
      ],
    })
    await seedTournament(mk('古い大会'), { name: '古い大会', eventDate: '2025-01-01' })
    await seedTournament(mk('新しい大会'), { name: '新しい大会', eventDate: '2026-06-01' })

    const player = (await searchPlayers('名人太郎'))[0]!
    const record = await getPlayerRecord(player.id)
    expect(record!.participations).toHaveLength(2)
    // 開催日降順：新しい大会が先頭
    expect(record!.participations[0]!.tournamentName).toBe('新しい大会')
    expect(record!.participations[1]!.tournamentName).toBe('古い大会')
  })

  it('存在しない player は null', async () => {
    expect(await getPlayerRecord(999_999)).toBeNull()
  })

  it('全試合が walkover/forfeit のみなら通算 0勝0敗', async () => {
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        classWith('E級', 'E', [
          {
            seqNo: 1,
            name: '不戦太郎',
            nameKana: null,
            affiliation: null,
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: null,
            matches: [
              { round: 1, roundLabel: null, opponentName: null, scoreDiff: null, result: 'win', status: 'walkover' },
              { round: 2, roundLabel: null, opponentName: '誰か', scoreDiff: null, result: 'lose', status: 'forfeit' },
            ],
          },
        ]),
      ],
    }
    await seedTournament(payload, { name: '不戦大会', eventDate: '2026-02-01' })

    const player = (await searchPlayers('不戦太郎'))[0]!
    const record = await getPlayerRecord(player.id)
    expect(record!.totalWins).toBe(0)
    expect(record!.totalLosses).toBe(0)
    expect(record!.participations[0]!.matches).toHaveLength(2)
  })
})

describe('getPlayerRecord — 順位導出・相手リンク・サマリー（T2）', () => {
  type Part = ParsedResultPayload['classes'][number]['participants'][number]
  type Mt = Part['matches'][number]

  const mt = (
    round: number,
    roundLabel: string | null,
    opponentName: string | null,
    scoreDiff: number | null,
    result: 'win' | 'lose',
    status: 'normal' | 'walkover' | 'forfeit' = 'normal',
  ): Mt => ({ round, roundLabel, opponentName, scoreDiff, result, status })

  const p = (seqNo: number, name: string, matches: Mt[]): Part => ({
    seqNo,
    name,
    nameKana: null,
    affiliation: null,
    prefecture: null,
    dan: null,
    memberNo: null,
    finalRank: null,
    matches,
  })

  const pRank = (seqNo: number, name: string, finalRank: string, matches: Mt[]): Part => ({
    ...p(seqNo, name, matches),
    finalRank,
  })

  // 4人シングルイリミ（準決勝→決勝）。A=優勝 / C=準優勝 / B・D=ベスト4。
  const bracket: ParsedResultPayload = {
    parserVersion: '1.0.0',
    classes: [
      classWith('A級', 'A', [
        p(1, 'A太郎', [mt(1, '準決勝', 'B太郎', 5, 'win'), mt(2, '決勝', 'C太郎', 3, 'win')]),
        p(2, 'B太郎', [mt(1, '準決勝', 'A太郎', 5, 'lose')]),
        p(3, 'C太郎', [mt(1, '準決勝', 'D太郎', 7, 'win'), mt(2, '決勝', 'A太郎', 3, 'lose')]),
        p(4, 'D太郎', [mt(1, '準決勝', 'C太郎', 7, 'lose')]),
      ]),
    ],
  }

  it('優勝者：rank=優勝/bracket=1、解決済みの相手に opponentPlayerId が付く、サマリーも集計', async () => {
    await seedTournament(bracket, { name: '選手権', eventDate: '2026-05-03' })
    const a = (await searchPlayers('A太郎'))[0]!
    const b = (await searchPlayers('B太郎'))[0]!
    const c = (await searchPlayers('C太郎'))[0]!
    const rec = (await getPlayerRecord(a.id))!
    const part = rec.participations[0]!
    expect(part.rank).toBe('優勝')
    expect(part.rankBracket).toBe(1)
    expect(part.matches[0]!.opponentName).toBe('B太郎')
    expect(part.matches[0]!.opponentPlayerId).toBe(b.id)
    expect(part.matches[1]!.opponentPlayerId).toBe(c.id)
    expect(rec.championships).toBe(1)
    expect(rec.nyushoCount).toBe(1)
    expect(rec.tournamentCount).toBe(1)
    expect(rec.currentGrade).toBe('A')
    expect(rec.activeYears).toEqual({ from: 2026, to: 2026 })
  })

  it('準決勝敗退：rank=ベスト4/bracket=4、入賞に数えるが優勝には数えない', async () => {
    await seedTournament(bracket, { name: '選手権', eventDate: '2026-05-03' })
    const b = (await searchPlayers('B太郎'))[0]!
    const rec = (await getPlayerRecord(b.id))!
    expect(rec.participations[0]!.rank).toBe('ベスト4')
    expect(rec.participations[0]!.rankBracket).toBe(4)
    expect(rec.championships).toBe(0)
    expect(rec.nyushoCount).toBe(1)
  })

  it('準優勝：rank=準優勝/bracket=2', async () => {
    await seedTournament(bracket, { name: '選手権', eventDate: '2026-05-03' })
    const c = (await searchPlayers('C太郎'))[0]!
    const rec = (await getPlayerRecord(c.id))!
    expect(rec.participations[0]!.rank).toBe('準優勝')
    expect(rec.participations[0]!.rankBracket).toBe(2)
    expect(rec.championships).toBe(0)
    expect(rec.nyushoCount).toBe(1)
  })

  it('導出不能（リーグ戦）は保存 final_rank にフォールバック・優勝/入賞に数えない', async () => {
    const league: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        classWith('B級', 'B', [
          pRank(1, 'リーグ太郎', '3位', [
            mt(1, '予選リーグ', '相手一郎', 2, 'win'),
            mt(2, '予選リーグ', '相手二郎', 1, 'lose'),
          ]),
        ]),
      ],
    }
    await seedTournament(league, { name: 'リーグ大会', eventDate: '2026-04-01' })
    const rec = (await getPlayerRecord((await searchPlayers('リーグ太郎'))[0]!.id))!
    const part = rec.participations[0]!
    expect(part.rank).toBe('3位')
    expect(part.rankBracket).toBeNull()
    expect(rec.championships).toBe(0)
    expect(rec.nyushoCount).toBe(0)
  })

  it('未解決の相手（級にいない生名）は opponentPlayerId=null', async () => {
    const payload: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [classWith('C級', 'C', [p(1, '単独太郎', [mt(1, '1回戦', '外部花子', 4, 'win')])])],
    }
    await seedTournament(payload, { name: '小大会', eventDate: '2026-02-02' })
    const rec = (await getPlayerRecord((await searchPlayers('単独太郎'))[0]!.id))!
    expect(rec.participations[0]!.matches[0]!.opponentName).toBe('外部花子')
    expect(rec.participations[0]!.matches[0]!.opponentPlayerId).toBeNull()
  })
})
