import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getTournamentResults, sortBlocks } from './results'

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

const p = (name: string, matches: Mt[] = [], finalRank: string | null = null): Part => ({
  seqNo: 1,
  name,
  nameKana: null,
  affiliation: null,
  prefecture: null,
  dan: null,
  memberNo: null,
  finalRank,
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

/**
 * 4 人シングルイリミの D 級（甲優勝／丙準優勝／乙・丁がベスト4=3位）。
 * R1: 甲>乙, 丙>丁 ／ R2(決勝): 甲>丙。
 */
function bracket4(): ParsedResultPayload['classes'][number] {
  return classWith('D級', 'D', [
    p('甲', [mt(1, '1回戦', '乙', 5, 'win'), mt(2, '決勝', '丙', 3, 'win')]),
    p('乙', [mt(1, '1回戦', '甲', 5, 'lose')]),
    p('丙', [mt(1, '1回戦', '丁', 4, 'win'), mt(2, '決勝', '甲', 3, 'lose')]),
    p('丁', [mt(1, '1回戦', '丙', 4, 'lose')]),
  ])
}

describe('getTournamentResults — 入賞者（derived_bracket 集約）', () => {
  it('優勝/2位/3位(同着)を bracket から導出する', async () => {
    const { tournamentId } = await seed('大会X', '2025-04-01', [bracket4()])
    const res = await getTournamentResults(tournamentId)
    expect(res).not.toBeNull()
    expect(res!.blocks).toHaveLength(1)
    const block = res!.blocks[0]!
    expect(block.label).toBe('D')
    expect(block.grade).toBe('D')

    const places = block.winners
    expect(places.map((w) => w.place)).toEqual([1, 2, 3])
    expect(places[0]!.label).toBe('優勝')
    expect(places[0]!.entries.map((e) => e.name)).toEqual(['甲'])
    expect(places[1]!.entries.map((e) => e.name)).toEqual(['丙'])
    // 3 位は同着（乙・丁）。順序は collation 依存なので集合で検証
    expect(new Set(places[2]!.entries.map((e) => e.name))).toEqual(new Set(['乙', '丁']))
    expect(places.every((w) => w.fromFinalRank === false)).toBe(true)
    // 入賞者の playerId は解決済み（戦績詳細リンク用）
    expect(places[0]!.entries[0]!.playerId).toBeTypeOf('number')
  })

  it('非導出級（リーグ）は final_rank から入賞者を拾う', async () => {
    const { tournamentId } = await seed('リーグ大会', '2025-04-01', [
      classWith('C級', 'C', [
        p('一', [mt(1, '予選リーグ', '二', 3, 'win')], '優勝'),
        p('二', [mt(1, '予選リーグ', '一', 3, 'lose')], '準優勝'),
        p('三', [mt(1, '予選リーグ', '一', 2, 'lose')], '3位'),
      ]),
    ])
    const res = await getTournamentResults(tournamentId)
    const block = res!.blocks[0]!
    expect(block.winners.map((w) => w.place)).toEqual([1, 2, 3])
    expect(block.winners.every((w) => w.fromFinalRank)).toBe(true)
    expect(block.winners[0]!.entries.map((e) => e.name)).toEqual(['一'])
    expect(block.winners[1]!.entries.map((e) => e.name)).toEqual(['二'])
  })
})

describe('getTournamentResults — クロス表', () => {
  it('列＝回戦昇順・行＝勝ち上がり順・敗退後は欠落', async () => {
    const { tournamentId } = await seed('大会X', '2025-04-01', [bracket4()])
    const res = await getTournamentResults(tournamentId)
    const { columns, rows } = res!.blocks[0]!.crosstab

    expect(columns.map((c) => c.round)).toEqual([1, 2])
    expect(columns.map((c) => c.label)).toEqual(['1回戦', '決勝'])

    // 勝ち上がり順：甲(優勝・R2勝)→丙(R2敗)→乙/丁(R1敗・同順は集合)
    expect(rows.map((r) => r.name).slice(0, 2)).toEqual(['甲', '丙'])
    expect(new Set(rows.map((r) => r.name).slice(2))).toEqual(new Set(['乙', '丁']))

    const ko = rows[0]! // 甲
    expect(ko.reachedRound).toBe(2)
    expect(ko.cells[1]).toMatchObject({ result: 'win', opponentName: '乙', scoreDiff: 5 })
    expect(ko.cells[2]).toMatchObject({ result: 'win', opponentName: '丙', scoreDiff: 3 })

    const otsu = rows.find((r) => r.name === '乙')!
    expect(otsu.reachedRound).toBe(1)
    expect(otsu.cells[1]).toMatchObject({ result: 'lose', opponentName: '甲' })
    // 敗退後（2回戦）は欠落
    expect(otsu.cells[2]).toBeUndefined()
  })

  it('不戦勝（walkover）は相手/枚数なしで正しく入る', async () => {
    const { tournamentId } = await seed('不戦大会', '2025-04-01', [
      classWith('E級', 'E', [
        p('P1', [mt(1, '1回戦', null, null, 'win', 'walkover'), mt(2, '決勝', 'P2', 4, 'win')]),
        p('P2', [mt(2, '決勝', 'P1', 4, 'lose')]),
      ]),
    ])
    const res = await getTournamentResults(tournamentId)
    const p1 = res!.blocks[0]!.crosstab.rows.find((r) => r.name === 'P1')!
    expect(p1.cells[1]).toMatchObject({ status: 'walkover', opponentName: null, scoreDiff: null })
  })
})

describe('getTournamentResults — 級ブロック（A1/A2 分割・並び）', () => {
  it('同一級の複数ブロックは A1/A2 に分ける', async () => {
    const { tournamentId } = await seed('分割大会', '2025-04-01', [
      classWith('A級①', 'A', [p('a1', []), p('a2', [])]),
      classWith('A級②', 'A', [p('a3', [])]),
      classWith('B級', 'B', [p('b1', [])]),
    ])
    const res = await getTournamentResults(tournamentId)
    const labels = sortBlocks(res!.blocks).map((b) => b.label)
    expect(labels).toEqual(['A1', 'A2', 'B'])
  })

  it('存在しない/不正な大会 id は null（0・負・小数・int4 超過で 500 にしない）', async () => {
    expect(await getTournamentResults(999999)).toBeNull()
    expect(await getTournamentResults(0)).toBeNull()
    expect(await getTournamentResults(-1)).toBeNull()
    expect(await getTournamentResults(1.5)).toBeNull()
    expect(await getTournamentResults(2147483648)).toBeNull() // int4 超過→overflow回避
  })
})
