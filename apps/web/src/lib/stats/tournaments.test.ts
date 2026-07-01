import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getTournamentList } from './tournaments'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

type Part = ParsedResultPayload['classes'][number]['participants'][number]

const p = (name: string): Part => ({
  seqNo: 1,
  name,
  nameKana: null,
  affiliation: null,
  prefecture: null,
  dan: null,
  memberNo: null,
  finalRank: null,
  matches: [],
})

function classWith(
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null,
  names: string[],
): ParsedResultPayload['classes'][number] {
  return {
    className: grade ? `${grade}級` : '無級',
    grade,
    sheetName: null,
    participants: names.map(p),
  }
}

async function seed(name: string, eventDate: string | null, classes: ParsedResultPayload['classes']) {
  return testDb.transaction(async (tx) =>
    materializeResultDraft(
      tx,
      { parserVersion: '1.0.0', classes },
      { tournamentName: name, eventDate, venue: null, sourceResultDraftId: 1 },
    ),
  )
}

describe('getTournamentList — 年別ビュー', () => {
  it('大会名・開催日・年・級構成・参加者数を返す', async () => {
    await seed('大会A', '2025-04-01', [
      classWith('D', ['甲', '乙']),
      classWith('C', ['丙']),
    ])
    const { rows, total } = await getTournamentList()
    expect(total).toBe(1)
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.name).toBe('大会A')
    expect(r.eventDate).toBe('2025-04-01')
    expect(r.year).toBe(2025)
    expect(r.grades).toEqual(['C', 'D']) // 正規順（A→E）
    expect(r.participantCount).toBe(3)
    expect(r.cancelled).toBe(false)
  })

  it('開催日降順・null 日付は末尾', async () => {
    await seed('2018大会', '2018-04-01', [classWith('D', ['a'])])
    await seed('2026大会', '2026-04-01', [classWith('D', ['b'])])
    await seed('日付不明', null, [classWith('D', ['c'])])
    const { rows } = await getTournamentList()
    expect(rows.map((r) => r.name)).toEqual(['2026大会', '2018大会', '日付不明'])
    expect(rows[2]!.year).toBeNull()
  })

  it('大会名で ILIKE 絞り込みできる', async () => {
    await seed('東京大会', '2025-04-01', [classWith('D', ['a'])])
    await seed('大阪大会', '2025-05-01', [classWith('D', ['b'])])
    const { rows, total } = await getTournamentList('東京')
    expect(total).toBe(1)
    expect(rows.map((r) => r.name)).toEqual(['東京大会'])
  })

  it('単一年で絞り込める（event_date 無しは除外）', async () => {
    await seed('2024大会', '2024-04-01', [classWith('D', ['a'])])
    await seed('2025大会', '2025-04-01', [classWith('D', ['b'])])
    await seed('日付不明', null, [classWith('D', ['c'])])
    const { rows, total } = await getTournamentList(undefined, 2025)
    expect(total).toBe(1)
    expect(rows.map((r) => r.name)).toEqual(['2025大会'])
  })

  it('limit/offset でページングし total は offset 非依存', async () => {
    for (let i = 1; i <= 5; i++) {
      await seed(`大会${i}`, `2025-0${i}-01`, [classWith('D', [`p${i}`])])
    }
    const page1 = await getTournamentList(undefined, undefined, 2, 0)
    expect(page1.total).toBe(5)
    expect(page1.rows).toHaveLength(2)
    // 開催日降順＝5月,4月
    expect(page1.rows.map((r) => r.name)).toEqual(['大会5', '大会4'])
    const page2 = await getTournamentList(undefined, undefined, 2, 2)
    expect(page2.total).toBe(5)
    expect(page2.rows.map((r) => r.name)).toEqual(['大会3', '大会2'])
  })

  it('不正な limit/offset/year でも 500 にせず既定で集計', async () => {
    await seed('大会A', '2025-04-01', [classWith('D', ['a'])])
    const res = await getTournamentList(undefined, Number.NaN, -5, -1)
    expect(res.total).toBe(1)
    expect(res.rows).toHaveLength(1)
  })
})
