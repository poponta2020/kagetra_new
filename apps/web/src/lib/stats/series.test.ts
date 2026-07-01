import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { tournamentSeries, tournamentSeriesEditions } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getSeriesDetail, getSeriesList } from './series'

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
): Mt => ({ round, roundLabel, opponentName, scoreDiff, result, status: 'normal' })

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

/** 甲優勝／乙準優勝の 2 人決勝（A 級）。 */
function finalPair(grade: 'A' | 'B' | 'C' | 'D' | 'E' = 'A'): ParsedResultPayload['classes'] {
  return [
    { className: `${grade}級`, grade, sheetName: null, participants: [
      p('甲', [mt(1, '決勝', '乙', 5, 'win')]),
      p('乙', [mt(1, '決勝', '甲', 5, 'lose')]),
    ] },
  ]
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

/** 系列＋回次台帳を仕込む（第3/2回は結果あり・第1回は中止で記録なし）。 */
async function seedSeries() {
  const [series] = await testDb
    .insert(tournamentSeries)
    .values({ name: 'テスト大会' })
    .returning({ id: tournamentSeries.id })
  const seriesId = series!.id
  // 中止回（記録なし・年あり）。
  await testDb.insert(tournamentSeriesEditions).values({
    seriesId,
    editionNumber: 1,
    year: 2021,
    status: 'cancelled',
  })
  // 結果あり回（大会名から autoResolveEdition が edition を自動作成・held）。
  await seed('第3回テスト大会A級', '2023-04-01', finalPair())
  await seed('第2回テスト大会A級', '2022-04-01', finalPair())
  return seriesId
}

describe('getSeriesList', () => {
  it('系列ごとに 累計回次・回次範囲・直近年・状態内訳 を返す', async () => {
    await seedSeries()
    const rows = await getSeriesList()
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.name).toBe('テスト大会')
    expect(r.editionCount).toBe(3)
    expect(r.editionNumberFrom).toBe(1)
    expect(r.editionNumberTo).toBe(3)
    expect(r.recentYear).toBe(2023)
    expect(r.heldCount).toBe(2)
    expect(r.cancelledCount).toBe(1)
    expect(r.unconfirmedCount).toBe(0)
  })

  it('直近開催年降順に並ぶ', async () => {
    await seedSeries()
    // 別系列（直近 2026）を追加＝先頭に来る。
    await testDb.insert(tournamentSeries).values({ name: '新しい大会' })
    await seed('第1回新しい大会B級', '2026-04-01', finalPair('B'))
    const rows = await getSeriesList()
    expect(rows.map((r) => r.name)).toEqual(['新しい大会', 'テスト大会'])
  })

  it('系列名で ILIKE 絞り込みできる', async () => {
    await seedSeries()
    expect((await getSeriesList('テスト')).map((r) => r.name)).toEqual(['テスト大会'])
    expect(await getSeriesList('存在しない')).toEqual([])
  })

  it('回次台帳の無い系列は count=0（空系列を held と誤集計しない・Codex R2 blocker）', async () => {
    await testDb.insert(tournamentSeries).values({ name: '空系列' })
    const rows = await getSeriesList('空系列')
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.editionCount).toBe(0)
    expect(r.heldCount).toBe(0)
    expect(r.cancelledCount).toBe(0)
    expect(r.unconfirmedCount).toBe(0)
    expect(r.editionNumberFrom).toBeNull()
    expect(r.recentYear).toBeNull()
  })

  it('検索語の % / _ は literal 扱い（ESCAPE 句）', async () => {
    await testDb.insert(tournamentSeries).values({ name: '100%大会' })
    await testDb.insert(tournamentSeries).values({ name: 'ABC大会' })
    // '%' は literal＝ '100%大会' だけ一致（ワイルドカードなら ABC大会 も一致してしまう）
    expect((await getSeriesList('100%')).map((r) => r.name)).toEqual(['100%大会'])
  })
})

describe('getSeriesDetail', () => {
  it('回次一覧（新しい順）＋優勝者＋参加者数＋状態を返す', async () => {
    const seriesId = await seedSeries()
    const detail = await getSeriesDetail(seriesId)
    expect(detail).not.toBeNull()
    expect(detail!.name).toBe('テスト大会')
    expect(detail!.editionNumberFrom).toBe(1)
    expect(detail!.editionNumberTo).toBe(3)
    expect(detail!.yearFrom).toBe(2021)
    expect(detail!.yearTo).toBe(2023)

    // 回次一覧は edition_number 降順
    expect(detail!.editions.map((e) => e.editionNumber)).toEqual([3, 2, 1])
    const ed3 = detail!.editions[0]!
    expect(ed3.status).toBe('held')
    expect(ed3.championName).toBe('甲')
    expect(ed3.participantCount).toBe(2)
    expect(ed3.tournamentId).toBeTypeOf('number')

    // 中止回＝記録なし（優勝者/参加者数 null・遷移先 null）
    const ed1 = detail!.editions[2]!
    expect(ed1.status).toBe('cancelled')
    expect(ed1.championName).toBeNull()
    expect(ed1.participantCount).toBeNull()
    expect(ed1.tournamentId).toBeNull()
  })

  it('参加者数推移は記録ある年＋中止年のみ・edition昇順・中止は cancelled フラグ', async () => {
    const seriesId = await seedSeries()
    const detail = await getSeriesDetail(seriesId)
    expect(detail!.participantTrend).toEqual([
      { year: 2021, count: 0, cancelled: true },
      { year: 2022, count: 2, cancelled: false },
      { year: 2023, count: 2, cancelled: false },
    ])
  })

  it('非導出級（リーグ）の優勝者は final_rank から拾う（大会詳細と単一ソース・Codex R3 blocker）', async () => {
    await testDb.insert(tournamentSeries).values({ name: 'リーグ系列' })
    // A 級がリーグ戦（bracket 導出不能）＋ B 級が通常トーナメント。最上位 A 級の優勝者を
    // final_rank から拾い、B 級の bracket=1 で上書きしないことを確認する。
    await seed('第5回リーグ系列', '2024-04-01', [
      {
        className: 'A級',
        grade: 'A',
        sheetName: null,
        participants: [
          { seqNo: 1, name: 'リーグ優勝', nameKana: null, affiliation: null, prefecture: null, dan: null, memberNo: null, finalRank: '優勝', matches: [{ round: 1, roundLabel: '予選リーグ', opponentName: 'リーグ2位', scoreDiff: 3, result: 'win', status: 'normal' }] },
          { seqNo: 2, name: 'リーグ2位', nameKana: null, affiliation: null, prefecture: null, dan: null, memberNo: null, finalRank: '準優勝', matches: [{ round: 1, roundLabel: '予選リーグ', opponentName: 'リーグ優勝', scoreDiff: 3, result: 'lose', status: 'normal' }] },
        ],
      },
      {
        className: 'B級',
        grade: 'B',
        sheetName: null,
        participants: [
          { seqNo: 1, name: 'B級王者', nameKana: null, affiliation: null, prefecture: null, dan: null, memberNo: null, finalRank: null, matches: [{ round: 1, roundLabel: '決勝', opponentName: 'B級2位', scoreDiff: 5, result: 'win', status: 'normal' }] },
          { seqNo: 2, name: 'B級2位', nameKana: null, affiliation: null, prefecture: null, dan: null, memberNo: null, finalRank: null, matches: [{ round: 1, roundLabel: '決勝', opponentName: 'B級王者', scoreDiff: 5, result: 'lose', status: 'normal' }] },
        ],
      },
    ])
    // beforeEach で truncate 済み＝この系列の id は 1。
    const d = await getSeriesDetail(1)
    expect(d).not.toBeNull()
    const ed = d!.editions.find((e) => e.editionNumber === 5)!
    // 最上位 A 級の final_rank『優勝』を採用（B 級の bracket=1『B級王者』で上書きしない）
    expect(ed.championName).toBe('リーグ優勝')
  })

  it('存在しない系列は null', async () => {
    expect(await getSeriesDetail(999999)).toBeNull()
    expect(await getSeriesDetail(0)).toBeNull()
  })
})
