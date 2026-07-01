import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { searchPlayers } from '@/lib/players/queries'
import { getPlayerRanking } from './ranking'

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

const p = (
  name: string,
  matches: Mt[],
  opts: { affiliation?: string | null; finalRank?: string | null } = {},
): Part => ({
  seqNo: 1,
  name,
  nameKana: null,
  affiliation: opts.affiliation ?? null,
  prefecture: null,
  dan: null,
  memberNo: null,
  finalRank: opts.finalRank ?? null,
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

/** 4人シングルイリミ（準決勝→決勝）。champ=優勝(1)/runner=準優勝(2)/semiX,semiY=ベスト4(4)。 */
function bracketClass(
  className: string,
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null,
  champ: string,
  runner: string,
  semiX: string,
  semiY: string,
): ParsedResultPayload['classes'][number] {
  return classWith(className, grade, [
    p(champ, [mt(1, '準決勝', semiX, 5, 'win'), mt(2, '決勝', runner, 3, 'win')]),
    p(semiX, [mt(1, '準決勝', champ, 5, 'lose')]),
    p(runner, [mt(1, '準決勝', semiY, 7, 'win'), mt(2, '決勝', champ, 3, 'lose')]),
    p(semiY, [mt(1, '準決勝', runner, 7, 'lose')]),
  ])
}

/** win/lose を並べた normal 試合の列（1 参加者だけの級＝ブラケット非導出）。 */
function manyMatches(wins: number, losses: number): Mt[] {
  const arr: Mt[] = []
  let r = 1
  for (let i = 0; i < wins; i++) arr.push(mt(r++, null, `勝相手${i}`, 5, 'win'))
  for (let i = 0; i < losses; i++) arr.push(mt(r++, null, `負相手${i}`, 3, 'lose'))
  return arr
}

async function idOf(name: string): Promise<number> {
  const res = await searchPlayers(name)
  return res[0]!.id
}

describe('getPlayerRanking — 出場回数', () => {
  it('参加数の降順・同値同順位・total を返す', async () => {
    // X=3大会 / Y=2大会 / Z=1大会
    await seed('大会1', '2026-01-01', [classWith('D級', 'D', [p('X太郎', []), p('Z太郎', [])])])
    await seed('大会2', '2026-02-01', [classWith('D級', 'D', [p('X太郎', []), p('Y太郎', [])])])
    await seed('大会3', '2026-03-01', [classWith('D級', 'D', [p('X太郎', []), p('Y太郎', [])])])

    const { rows, total } = await getPlayerRanking('participations')
    expect(total).toBe(3)
    expect(rows.map((r) => [r.displayName, r.value, r.rank])).toEqual([
      ['X太郎', 3, 1],
      ['Y太郎', 2, 2],
      ['Z太郎', 1, 3],
    ])
  })

  it('直近大会の所属会を返す（searchPlayers と同一の相関サブクエリ）', async () => {
    await seed('古い大会', '2024-01-01', [classWith('D級', 'D', [p('所属太郎', [], { affiliation: '札幌' })])])
    await seed('新しい大会', '2026-05-01', [classWith('D級', 'D', [p('所属太郎', [], { affiliation: '東京' })])])

    const { rows } = await getPlayerRanking('participations')
    expect(rows[0]!.displayName).toBe('所属太郎')
    expect(rows[0]!.affiliation).toBe('東京')
  })
})

describe('getPlayerRanking — 勝利数 / 対戦数（normal のみ）', () => {
  it('勝利数は normal の win のみ・対戦数は normal のみ（不戦勝/棄権は除外）', async () => {
    await seed('大会1', '2026-01-01', [
      classWith('D級', 'D', [
        // P1: normal win×2, normal lose×1, walkover win×1 → wins=2, matches=3
        p('P1太郎', [
          mt(1, null, '相手a', 5, 'win'),
          mt(2, null, '相手b', 4, 'win'),
          mt(3, null, '相手c', 2, 'lose'),
          mt(4, null, null, null, 'win', 'walkover'),
        ]),
        // P2: normal win×1 → wins=1, matches=1
        p('P2太郎', [mt(1, null, '相手d', 6, 'win')]),
      ]),
    ])

    const wins = await getPlayerRanking('wins')
    expect(wins.total).toBe(2)
    expect(wins.rows.map((r) => [r.displayName, r.value, r.rank])).toEqual([
      ['P1太郎', 2, 1],
      ['P2太郎', 1, 2],
    ])

    const games = await getPlayerRanking('matches')
    expect(games.rows.map((r) => [r.displayName, r.value])).toEqual([
      ['P1太郎', 3],
      ['P2太郎', 1],
    ])
  })
})

describe('getPlayerRanking — 勝率（最低20試合で足切り）', () => {
  it('20試合未満は除外・勝率降順・sub に母数（対戦数）を返す', async () => {
    await seed('大会1', '2026-01-01', [
      classWith('D級', 'D', [p('高勝率', manyMatches(15, 10))]), // 25試合 60.0%
    ])
    await seed('大会2', '2026-01-02', [
      classWith('D級', 'D', [p('五分', manyMatches(11, 11))]), // 22試合 50.0%
    ])
    await seed('大会3', '2026-01-03', [
      classWith('D級', 'D', [p('少数精鋭', manyMatches(10, 0))]), // 10試合 100%（足切りで除外）
    ])

    const { rows, total } = await getPlayerRanking('winRate')
    expect(total).toBe(2) // 少数精鋭は 20試合未満で除外
    expect(rows.map((r) => [r.displayName, r.value, r.sub, r.rank])).toEqual([
      ['高勝率', 60, 25, 1],
      ['五分', 50, 22, 2],
    ])
    expect(rows.some((r) => r.displayName === '少数精鋭')).toBe(false)
  })
})

describe('getPlayerRanking — 優勝回数（bracket=1）', () => {
  it('優勝者のみ・回数をカウント・非優勝は除外', async () => {
    await seed('選手権1', '2026-01-01', [bracketClass('A級', 'A', 'A太郎', 'C太郎', 'B太郎', 'D太郎')])
    await seed('選手権2', '2026-02-01', [bracketClass('A級', 'A', 'A太郎', 'F太郎', 'G太郎', 'H太郎')])
    await seed('選手権3', '2026-03-01', [bracketClass('A級', 'A', 'K太郎', 'L太郎', 'M太郎', 'N太郎')])

    const { rows, total } = await getPlayerRanking('championships')
    expect(total).toBe(2) // A太郎 と K太郎 のみ
    expect(rows.map((r) => [r.displayName, r.value, r.rank])).toEqual([
      ['A太郎', 2, 1],
      ['K太郎', 1, 2],
    ])
    // 準優勝・ベスト4 は優勝ランキングに現れない
    expect(rows.some((r) => r.displayName === 'C太郎')).toBe(false)
  })
})

describe('getPlayerRanking — 入賞回数（bracket≤8）', () => {
  it('導出できた bracket≤8 のみを数える・導出不能級（null）は除外', async () => {
    // 4人ブラケット：A(1)/C(2)/B(4)/D(4) 全員が入賞（bracket≤8）
    await seed('選手権', '2026-01-01', [bracketClass('A級', 'A', 'A太郎', 'C太郎', 'B太郎', 'D太郎')])
    // 総当たり（非導出）：L太郎 は bracket=null → 入賞に数えない
    await seed('総当たり', '2026-02-01', [
      classWith('B級', 'B', [
        p('L太郎', [mt(1, '1回戦', 'M太郎', 2, 'win'), mt(3, '3回戦', 'N太郎', 1, 'lose')], { finalRank: '優勝' }),
        p('M太郎', [mt(1, '1回戦', 'L太郎', 2, 'lose'), mt(2, '2回戦', 'N太郎', 3, 'win')], { finalRank: '2位' }),
        p('N太郎', [mt(2, '2回戦', 'M太郎', 3, 'lose'), mt(3, '3回戦', 'L太郎', 1, 'win')], { finalRank: '3位' }),
      ]),
    ])

    const { rows, total } = await getPlayerRanking('nyusho')
    expect(total).toBe(4) // A/C/B/D のみ
    const names = rows.map((r) => r.displayName).sort()
    expect(names).toEqual(['A太郎', 'B太郎', 'C太郎', 'D太郎'])
    expect(rows.every((r) => r.value === 1)).toBe(true)
    // 非導出級の L太郎（final_rank=優勝）は入賞に入らない
    expect(rows.some((r) => r.displayName === 'L太郎')).toBe(false)
  })
})

describe('getPlayerRanking — 期間フィルタ', () => {
  it('year 範囲で絞り・event_date 無し大会は範囲指定時に除外', async () => {
    await seed('2018大会', '2018-05-01', [classWith('D級', 'D', [p('期間太郎', [])])])
    await seed('2020大会', '2020-05-01', [classWith('D級', 'D', [p('期間太郎', [])])])
    await seed('日付不明大会', null, [classWith('D級', 'D', [p('期間太郎', [])])])

    // フィルタ無し：3大会すべて
    const all = await getPlayerRanking('participations')
    expect(all.rows[0]!.value).toBe(3)

    // 2019〜2020：2020大会のみ（2018 は範囲外・null は除外）
    const ranged = await getPlayerRanking('participations', { yearFrom: 2019, yearTo: 2020 })
    expect(ranged.rows[0]!.value).toBe(1)
  })
})

describe('getPlayerRanking — 級フィルタ', () => {
  it('grades で絞る', async () => {
    await seed('A大会', '2026-01-01', [classWith('A級', 'A', [p('級太郎', [])])])
    await seed('C大会', '2026-02-01', [classWith('C級', 'C', [p('級太郎', [])])])

    expect((await getPlayerRanking('participations', { grades: ['A'] })).rows[0]!.value).toBe(1)
    expect((await getPlayerRanking('participations', { grades: ['A', 'C'] })).rows[0]!.value).toBe(2)
  })
})

describe('getPlayerRanking — 同順位（競技ランキング=タイの次は順位を飛ばす）', () => {
  it('3人が同値で1位タイ→次は4位', async () => {
    // X/Y/W=2大会（1位タイ）、Z=1大会（次順位＝4位）
    await seed('大会1', '2026-01-01', [
      classWith('D級', 'D', [p('X太郎', []), p('Y太郎', []), p('W太郎', []), p('Z太郎', [])]),
    ])
    await seed('大会2', '2026-02-01', [
      classWith('D級', 'D', [p('X太郎', []), p('Y太郎', []), p('W太郎', [])]),
    ])

    const { rows } = await getPlayerRanking('participations')
    const byName = new Map(rows.map((r) => [r.displayName, r]))
    expect(byName.get('X太郎')!.rank).toBe(1)
    expect(byName.get('Y太郎')!.rank).toBe(1)
    expect(byName.get('W太郎')!.rank).toBe(1)
    // 3人が1位タイ → 次は4位（2,3 を飛ばす）
    expect(byName.get('Z太郎')!.rank).toBe(4)
    // 同値内は表示名昇順
    const top3 = rows.slice(0, 3).map((r) => r.displayName)
    expect(top3).toEqual([...top3].sort())
  })
})

describe('getPlayerRanking — ページング / total', () => {
  it('limit/offset でページングしても rank と total は全体基準', async () => {
    // 5人を distinct な参加数に（A=5,B=4,C=3,D=2,E=1）
    for (let n = 5; n >= 1; n--) {
      for (let k = 0; k < n; k++) {
        await seed(`t${n}-${k}`, `2026-0${(k % 9) + 1}-01`, [
          classWith('D級', 'D', [p(`Rank${6 - n}`, [])]),
        ])
      }
    }

    const page1 = await getPlayerRanking('participations', {}, 2, 0)
    expect(page1.total).toBe(5)
    expect(page1.rows.map((r) => r.rank)).toEqual([1, 2])
    expect(page1.rows[0]!.value).toBe(5)

    const page2 = await getPlayerRanking('participations', {}, 2, 2)
    expect(page2.total).toBe(5) // total は offset に関係なく全体
    expect(page2.rows.map((r) => r.rank)).toEqual([3, 4])
    expect(page2.rows[0]!.value).toBe(3)
  })

  it('該当0人なら空配列・total=0', async () => {
    const { rows, total } = await getPlayerRanking('championships')
    expect(rows).toEqual([])
    expect(total).toBe(0)
  })

  it('offset が末尾を超えても total は offset 非依存の全体件数（rows は空）', async () => {
    await seed('大会1', '2026-01-01', [
      classWith('D級', 'D', [p('甲', []), p('乙', []), p('丙', [])]),
    ])
    // 3 人しかいないが offset=10 → このページは空。total は 3 のまま（契約）。
    const { rows, total } = await getPlayerRanking('participations', {}, 100, 10)
    expect(rows).toEqual([])
    expect(total).toBe(3)
  })
})

describe('getPlayerRanking — 不正入力の防御（Server Action 境界）', () => {
  it('改変された metric/grade/年/offset でも例外を投げず既定で集計する', async () => {
    await seed('大会1', '2026-01-01', [classWith('D級', 'D', [p('防御太郎', [])])])

    // 不正 metric→既定(participations)・enum外grade/NaN年→除外・負offset→0 に丸められる。
    // 型を欺いて（as）改変クライアントのペイロードを模す。
    const res = await getPlayerRanking(
      'bogus' as unknown as 'participations',
      { grades: ['Z'] as unknown as Array<'A'>, yearFrom: Number.NaN, yearTo: -1 },
      100,
      -5,
    )
    // 例外にならず、フィルタが実質無効化されて「防御太郎」が出場ランキングに出る。
    expect(res.total).toBe(1)
    expect(res.rows[0]!.displayName).toBe('防御太郎')
    expect(res.rows[0]!.value).toBe(1)
  })
})
