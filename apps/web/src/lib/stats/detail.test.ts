import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getStatsDetail, type ScoreSeries, type YearSeries } from './detail'

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
  opponentName: string | null,
  scoreDiff: number | null,
  result: 'win' | 'lose',
  status: 'normal' | 'walkover' | 'forfeit' = 'normal',
): Mt => ({ round, roundLabel: null, opponentName, scoreDiff, result, status })

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

function byKey<T extends { key: string }>(series: T[]): Map<string, T> {
  return new Map(series.map((s) => [s.key, s]))
}

describe('getStatsDetail — score（枚数差ヒスト・全級＋各級）', () => {
  it('全級は grade 無し級も含む・各級は自級のみ・6 系列', async () => {
    await seed('大会', '2025-04-01', [
      classWith('A級', 'A', [p('a', [mt(1, 'x', 5, 'win')])]),
      classWith('B級', 'B', [p('b', [mt(1, 'y', 3, 'win')])]),
      classWith('無級', null, [p('n', [mt(1, 'z', 5, 'win')])]),
    ])

    const res = await getStatsDetail('score')
    expect(res.metric).toBe('score')
    const series = res.series as ScoreSeries[]
    // 系列順は all→A→B→C→D→E
    expect(series.map((s) => s.key)).toEqual(['all', 'A', 'B', 'C', 'D', 'E'])

    const m = byKey(series)
    // all：5 枚差 = A(1) + 無級(1) = 2、3 枚差 = B(1)
    expect(m.get('all')!.bins[4]).toBe(2)
    expect(m.get('all')!.bins[2]).toBe(1)
    expect(m.get('all')!.average).toBeCloseTo((5 * 2 + 3) / 3, 5)
    // A：5 枚差のみ
    expect(m.get('A')!.bins[4]).toBe(1)
    expect(m.get('A')!.average).toBeCloseTo(5, 5)
    // B：3 枚差のみ
    expect(m.get('B')!.bins[2]).toBe(1)
    expect(m.get('B')!.average).toBeCloseTo(3, 5)
    // 空級
    expect(m.get('C')!.bins.every((b) => b === 0)).toBe(true)
    expect(m.get('C')!.average).toBe(0)
    // 各系列 25 本
    for (const s of series) expect(s.bins).toHaveLength(25)
  })
})

describe('getStatsDetail — competitors（年別 競技人口・全級=distinct／各級=1人=1級）', () => {
  it('全級は distinct 選手数・各級はその年の直近級のみ（複数級出場でも重複しない）', async () => {
    // 2025：A級に X,Y／B級に X（X は同一大会で両級＝異常データ）→ X は上位級 A のみ。
    // 無級の Z は all にのみ算入（級パネルには現れない）。
    await seed('大会', '2025-04-01', [
      classWith('A級', 'A', [p('X', []), p('Y', [])]),
      classWith('B級', 'B', [p('X', [])]),
      classWith('無級', null, [p('Z', [])]),
    ])

    const res = await getStatsDetail('competitors')
    expect(res.metric).toBe('competitors')
    const m = byKey(res.series as YearSeries[])
    // 全級 = distinct(X,Y,Z) = 3（従来どおり）。A〜E 合計(2) との差＝grade なし級のみの Z
    expect(m.get('all')!.points).toEqual([{ year: 2025, count: 3 }])
    expect(m.get('A')!.points).toEqual([{ year: 2025, count: 2 }])
    // 従来の級ごと distinct では B にも X が立っていた（1人=1級化で解消）
    expect(m.get('B')!.points).toEqual([])
    expect(m.get('C')!.points).toEqual([])
  })

  it('同一年内で B→A と昇級した選手はその年 A のみに1カウント', async () => {
    await seed('春大会', '2025-04-01', [classWith('B級', 'B', [p('X', [])])])
    await seed('夏大会', '2025-06-01', [classWith('A級', 'A', [p('X', [])])])

    const res = await getStatsDetail('competitors')
    const m = byKey(res.series as YearSeries[])
    expect(m.get('A')!.points).toEqual([{ year: 2025, count: 1 }])
    expect(m.get('B')!.points).toEqual([])
    expect(m.get('all')!.points).toEqual([{ year: 2025, count: 1 }])
  })

  it('年をまたぐ昇級は各年それぞれの級にカウント（過去年は塗り替えない）', async () => {
    await seed('2023大会', '2023-04-01', [classWith('B級', 'B', [p('X', [])])])
    await seed('2024大会', '2024-04-01', [classWith('A級', 'A', [p('X', [])])])

    const res = await getStatsDetail('competitors')
    const m = byKey(res.series as YearSeries[])
    expect(m.get('B')!.points).toEqual([{ year: 2023, count: 1 }])
    expect(m.get('A')!.points).toEqual([{ year: 2024, count: 1 }])
    expect(m.get('all')!.points).toEqual([
      { year: 2023, count: 1 },
      { year: 2024, count: 1 },
    ])
  })

  it('同日複数大会は id 降順で直近級が決定的', async () => {
    // 同日 2 大会：後から取り込んだ（id 大）方の B を採用
    await seed('同日1', '2025-04-01', [classWith('C級', 'C', [p('X', [])])])
    await seed('同日2', '2025-04-01', [classWith('B級', 'B', [p('X', [])])])

    const res = await getStatsDetail('competitors')
    const m = byKey(res.series as YearSeries[])
    expect(m.get('B')!.points).toEqual([{ year: 2025, count: 1 }])
    expect(m.get('C')!.points).toEqual([])
  })
})

describe('getStatsDetail — participations（年別 延べ参加・加算）', () => {
  it('全級は grade 無し級も含む合算・各級は自級', async () => {
    await seed('大会', '2025-04-01', [
      classWith('A級', 'A', [p('X', []), p('Y', [])]), // 2
      classWith('B級', 'B', [p('X', [])]), // 1
      classWith('無級', null, [p('Z', [])]), // 1（all にのみ算入）
    ])

    const res = await getStatsDetail('participations')
    const m = byKey(res.series as YearSeries[])
    // 全級 = 2 + 1 + 1(無級) = 4
    expect(m.get('all')!.points).toEqual([{ year: 2025, count: 4 }])
    expect(m.get('A')!.points).toEqual([{ year: 2025, count: 2 }])
    expect(m.get('B')!.points).toEqual([{ year: 2025, count: 1 }])
    // 無級は各級系列には現れない
    expect(m.get('C')!.points).toEqual([])
  })
})

describe('getStatsDetail — 期間フィルタ / 防御', () => {
  it('year 範囲で窓を絞る', async () => {
    await seed('2018大会', '2018-04-01', [classWith('A級', 'A', [p('甲', [])])])
    await seed('2020大会', '2020-04-01', [classWith('A級', 'A', [p('乙', [])])])

    const res = await getStatsDetail('competitors', { yearFrom: 2019, yearTo: 2020 })
    const m = byKey(res.series as YearSeries[])
    expect(m.get('all')!.points).toEqual([{ year: 2020, count: 1 }])
  })

  it('不正 metric は score へ丸め・例外を投げない', async () => {
    await seed('大会', '2025-04-01', [classWith('A級', 'A', [p('a', [mt(1, 'x', 4, 'win')])])])
    const res = await getStatsDetail('bogus' as unknown as 'score')
    expect(res.metric).toBe('score')
    const m = byKey(res.series as ScoreSeries[])
    expect(m.get('all')!.bins[3]).toBe(1) // 4 枚差
  })
})
