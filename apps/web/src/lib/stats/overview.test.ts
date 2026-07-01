import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getStatsOverview } from './overview'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

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

const p = (name: string, matches: Mt[] = []): Part => ({
  seqNo: 1,
  name,
  nameKana: null,
  affiliation: null,
  prefecture: null,
  dan: null,
  memberNo: null,
  finalRank: null,
  matches,
})

function classWith(
  className: string,
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null,
  participants: Part[],
): ParsedResultPayload['classes'][number] {
  return { className, grade, sheetName: null, participants }
}

async function seed(
  name: string,
  eventDate: string | null,
  classes: ParsedResultPayload['classes'],
) {
  return testDb.transaction(async (tx) =>
    materializeResultDraft(
      tx,
      { parserVersion: '1.0.0', classes },
      { tournamentName: name, eventDate, venue: null, sourceResultDraftId: 1 },
    ),
  )
}

describe('getStatsOverview — 絶対数カード', () => {
  it('競技人口=distinct player・大会数・総対戦数(行)・延べ参加を返す', async () => {
    await seed('大会A', '2025-04-01', [
      classWith('D級', 'D', [
        p('X太郎', [mt(1, null, '相手a', 5, 'win'), mt(2, null, '相手b', 3, 'lose')]),
        p('Y太郎', [mt(1, null, '相手c', 4, 'win')]),
      ]),
    ])
    await seed('大会B', '2025-05-01', [
      classWith('C級', 'C', [p('X太郎', [mt(1, null, '相手d', 5, 'win')])]),
    ])

    const { totals } = await getStatsOverview()
    expect(totals.tournaments).toBe(2)
    expect(totals.competitors).toBe(2) // X太郎・Y太郎（X は 2 大会でも 1 人）
    expect(totals.participations).toBe(3) // 大会A 2 + 大会B 1
    expect(totals.matches).toBe(4) // 大会A 3 行 + 大会B 1 行
  })

  it('期間フィルタで event_date 無し大会・範囲外を除外する', async () => {
    await seed('2018大会', '2018-04-01', [classWith('D級', 'D', [p('甲', [])])])
    await seed('2020大会', '2020-04-01', [classWith('D級', 'D', [p('乙', [])])])
    await seed('日付不明', null, [classWith('D級', 'D', [p('丙', [])])])

    const all = await getStatsOverview()
    expect(all.totals.tournaments).toBe(3)
    expect(all.totals.participations).toBe(3)

    // 2019〜2020：2020大会のみ（2018 範囲外・null 除外）
    const ranged = await getStatsOverview({ yearFrom: 2019, yearTo: 2020 })
    expect(ranged.totals.tournaments).toBe(1)
    expect(ranged.totals.participations).toBe(1)
    expect(ranged.totals.competitors).toBe(1)
  })
})

describe('getStatsOverview — 図1 級別構成の推移', () => {
  it('年×級の延べ参加を pivot（grade 無し級は除外・A〜E 0 埋め）', async () => {
    await seed('2025大会', '2025-04-01', [
      classWith('A級', 'A', [p('a1', []), p('a2', [])]),
      classWith('B級', 'B', [p('b1', [])]),
      classWith('無級', null, [p('n1', [])]), // grade null → 構成から除外
    ])
    await seed('2026大会', '2026-04-01', [classWith('A級', 'A', [p('a3', [])])])

    const { gradeComposition } = await getStatsOverview()
    expect(gradeComposition).toEqual([
      { year: 2025, counts: { A: 2, B: 1, C: 0, D: 0, E: 0 } },
      { year: 2026, counts: { A: 1, B: 0, C: 0, D: 0, E: 0 } },
    ])
  })
})

describe('getStatsOverview — 図2 新規参入者（初出場年・2011〜）', () => {
  it('初出場年は全データ由来・2010 は除外・再出場年には数えない', async () => {
    // 太郎A：2010 初出場（除外）
    await seed('2010大会', '2010-04-01', [classWith('D級', 'D', [p('太郎A', [])])])
    // 太郎B：2012 初出場 → 2013 再出場（2012 のみ）
    await seed('2012大会1', '2012-04-01', [classWith('D級', 'D', [p('太郎B', []), p('太郎C', [])])])
    await seed('2013大会', '2013-04-01', [classWith('D級', 'D', [p('太郎B', [])])])
    // 太郎D：2014 初出場
    await seed('2014大会', '2014-04-01', [classWith('D級', 'D', [p('太郎D', [])])])

    const all = await getStatsOverview()
    expect(all.newcomers).toEqual([
      { year: 2012, count: 2 }, // 太郎B・太郎C
      { year: 2014, count: 1 }, // 太郎D
    ])

    // 期間窓：2013〜 → 2014 のみ（デビュー年自体は全データ由来だが表示窓で絞る）
    const windowed = await getStatsOverview({ yearFrom: 2013 })
    expect(windowed.newcomers).toEqual([{ year: 2014, count: 1 }])
  })
})

describe('getStatsOverview — 図3 一人当たり 平均年参加数（x=級）', () => {
  it('(選手,年) の distinct 大会数を級で平均・A〜E を常に返す', async () => {
    // D級 2026：X は 2 大会・Y は 1 大会 → 平均 (2+1)/2 = 1.5
    await seed('大会1', '2026-04-01', [classWith('D級', 'D', [p('X', [])])])
    await seed('大会2', '2026-05-01', [classWith('D級', 'D', [p('X', []), p('Y', [])])])

    const { perPlayerAvg } = await getStatsOverview()
    const byGrade = new Map(perPlayerAvg.map((g) => [g.grade, g.avg]))
    expect(byGrade.get('D')).toBeCloseTo(1.5, 5)
    expect(byGrade.get('A')).toBe(0)
    // A〜E の 5 本を必ず返す
    expect(perPlayerAvg.map((g) => g.grade)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('getStatsOverview — 図4 スコア統計（枚数差ヒスト）', () => {
  it('normal の勝者行のみ・1〜25 の 25 本・平均は試合数で加重', async () => {
    await seed('大会', '2025-04-01', [
      classWith('D級', 'D', [
        p('P1', [mt(1, null, 'x', 5, 'win'), mt(2, null, 'y', 10, 'lose')]), // lose は除外
        p('P2', [mt(1, null, 'z', 5, 'win')]),
        p('P3', [mt(1, null, 'w', 3, 'win')]),
        p('P4', [mt(1, null, null, null, 'win', 'walkover')]), // 不戦勝は除外
      ]),
    ])

    const { scoreHistogram } = await getStatsOverview()
    expect(scoreHistogram.bins).toHaveLength(25)
    expect(scoreHistogram.bins[4]).toBe(2) // 5 枚差 ×2
    expect(scoreHistogram.bins[2]).toBe(1) // 3 枚差 ×1
    expect(scoreHistogram.bins[9]).toBe(0) // 10 枚差は lose なので 0
    // 平均 = (5*2 + 3*1) / 3 = 13/3
    expect(scoreHistogram.average).toBeCloseTo(13 / 3, 5)
  })

  it('データ無しは全 0・平均 0', async () => {
    const { scoreHistogram } = await getStatsOverview()
    expect(scoreHistogram.bins.every((b) => b === 0)).toBe(true)
    expect(scoreHistogram.average).toBe(0)
  })
})

describe('getStatsOverview — 図5/6 年別 競技人口・大会参加人数', () => {
  it('競技人口=distinct player・大会参加人数=延べ参加を年別に', async () => {
    await seed('2025大会', '2025-04-01', [classWith('D級', 'D', [p('X', []), p('Y', [])])])
    await seed('2026大会', '2026-04-01', [classWith('D級', 'D', [p('X', [])])])

    const { competitorsByYear, participationsByYear } = await getStatsOverview()
    expect(competitorsByYear).toEqual([
      { year: 2025, count: 2 },
      { year: 2026, count: 1 },
    ])
    expect(participationsByYear).toEqual([
      { year: 2025, count: 2 },
      { year: 2026, count: 1 },
    ])
  })
})

describe('getStatsOverview — 不正入力の防御', () => {
  it('改変された年/級でも例外を投げず既定集計（級は無視）', async () => {
    await seed('大会', '2025-04-01', [classWith('D級', 'D', [p('防御', [])])])
    const res = await getStatsOverview({
      yearFrom: Number.NaN,
      yearTo: -1,
      grades: ['Z'] as unknown as Array<'A'>,
    })
    // フィルタ実質無効 → 大会統計は級を無視するので防御選手が数えられる
    expect(res.totals.competitors).toBe(1)
    expect(res.totals.participations).toBe(1)
  })
})
