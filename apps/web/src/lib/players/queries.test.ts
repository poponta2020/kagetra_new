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
