import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { tournamentSeries, tournamentSeriesEditions } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  autoResolveEdition,
  findOrCreateEdition,
  findOrCreateSeries,
  normalizeForMatch,
  parseAnnouncementName,
  parseEditionNumber,
  parseSeriesName,
  rankSeriesCandidates,
  scoreSeries,
  suggestEditionFromName,
  type SeriesRow,
} from './resolve'

describe('edition resolve — pure helpers', () => {
  describe('parseEditionNumber', () => {
    it('半角「第27回」を 27 にする', () => {
      expect(parseEditionNumber('第27回こばえちゃ山形酒田大会')).toBe(27)
    })
    it('全角「第２７回」も NFKC で 27 にする', () => {
      expect(parseEditionNumber('第２７回さがみ野大会')).toBe(27)
    })
    it('間にスペースがあっても拾う', () => {
      expect(parseEditionNumber('第 3 回テスト大会')).toBe(3)
    })
    it('回次がなければ null', () => {
      expect(parseEditionNumber('全日本かるた選手権大会')).toBeNull()
    })
  })

  describe('parseSeriesName', () => {
    it('第N回と級サフィックスを落とす', () => {
      expect(parseSeriesName('第27回こばえちゃ山形酒田大会C級')).toBe('こばえちゃ山形酒田大会')
    })
    it('複数級（A・B級）も落とす', () => {
      expect(parseSeriesName('第10回テスト大会A・B級')).toBe('テスト大会')
    })
    it('範囲級（A〜C級）も落とす', () => {
      expect(parseSeriesName('第5回近江神宮大会A〜C級')).toBe('近江神宮大会')
    })
    it('カッコ付き級（（A級））も落とす', () => {
      expect(parseSeriesName('第8回大津大会（A級）')).toBe('大津大会')
    })
    it('級がなければ第N回だけ落とす', () => {
      expect(parseSeriesName('第65回全日本かるた選手権大会')).toBe('全日本かるた選手権大会')
    })
  })

  describe('normalizeForMatch', () => {
    it('全角英数・空白・装飾を畳む', () => {
      expect(normalizeForMatch('★ こばえちゃ 山形・酒田 大会 ')).toBe(
        normalizeForMatch('こばえちゃ山形酒田大会'),
      )
    })
  })

  describe('scoreSeries / rankSeriesCandidates', () => {
    const series: SeriesRow[] = [
      { id: 1, name: 'こばえちゃ山形酒田大会', aliases: [], kind: 'individual' },
      { id: 2, name: 'シニア選手権', aliases: ['シニア選手権大会'], kind: 'individual' },
      { id: 3, name: 'さがみ野大会', aliases: [], kind: 'individual' },
    ]
    it('正規化完全一致は 100', () => {
      expect(scoreSeries('こばえちゃ山形酒田大会', series[0]!)).toBe(100)
    })
    it('alias 完全一致も 100', () => {
      expect(scoreSeries('シニア選手権大会', series[1]!)).toBe(100)
    })
    it('包含は 50', () => {
      expect(scoreSeries('さがみ野', series[2]!)).toBe(50)
    })
    it('無関係は 0', () => {
      expect(scoreSeries('全日本選手権', series[0]!)).toBe(0)
    })
    it('rank は完全一致を先頭に', () => {
      const ranked = rankSeriesCandidates('こばえちゃ山形酒田大会', series)
      expect(ranked[0]?.series.id).toBe(1)
      expect(ranked[0]?.score).toBe(100)
    })
  })

  describe('parseAnnouncementName', () => {
    it('回次と系列名候補をまとめて返す', () => {
      expect(parseAnnouncementName('第27回こばえちゃ山形酒田大会C級')).toEqual({
        editionNumber: 27,
        seriesNameGuess: 'こばえちゃ山形酒田大会',
      })
    })
  })
})

describe('edition resolve — DB', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  async function seedSeries(name: string, aliases: string[] = []) {
    const [s] = await testDb
      .insert(tournamentSeries)
      .values({ name, aliases, kind: 'individual' })
      .returning({ id: tournamentSeries.id })
    return s!.id
  }

  describe('findOrCreateEdition', () => {
    it('既存 edition を解決する（作成しない）', async () => {
      const seriesId = await seedSeries('こばえちゃ山形酒田大会')
      const [e] = await testDb
        .insert(tournamentSeriesEditions)
        .values({ seriesId, editionNumber: 27, year: 2026, status: 'held' })
        .returning({ id: tournamentSeriesEditions.id })

      const res = await findOrCreateEdition(testDb, { seriesId, editionNumber: 27, status: 'held' })
      expect(res.created).toBe(false)
      expect(res.editionId).toBe(e!.id)
    })

    it('無ければ新規作成する', async () => {
      const seriesId = await seedSeries('さがみ野大会')
      const res = await findOrCreateEdition(testDb, {
        seriesId,
        editionNumber: 40,
        year: 2026,
        status: 'unconfirmed',
      })
      expect(res.created).toBe(true)
      const row = await testDb
        .select()
        .from(tournamentSeriesEditions)
        .where(eq(tournamentSeriesEditions.id, res.editionId))
        .limit(1)
      expect(row[0]?.editionNumber).toBe(40)
      expect(row[0]?.status).toBe('unconfirmed')
    })

    it('冪等: 2 回呼んでも 1 行（同 id）', async () => {
      const seriesId = await seedSeries('テスト大会')
      const a = await findOrCreateEdition(testDb, { seriesId, editionNumber: 1, status: 'held' })
      const b = await findOrCreateEdition(testDb, { seriesId, editionNumber: 1, status: 'held' })
      expect(a.editionId).toBe(b.editionId)
      const all = await testDb
        .select()
        .from(tournamentSeriesEditions)
        .where(
          and(
            eq(tournamentSeriesEditions.seriesId, seriesId),
            eq(tournamentSeriesEditions.editionNumber, 1),
          ),
        )
      expect(all).toHaveLength(1)
    })

    it('既存 unconfirmed を held(結果取込)で解決すると held に昇格＋year/rawName 補完（R2）', async () => {
      const seriesId = await seedSeries('こばえちゃ山形酒田大会')
      const [e] = await testDb
        .insert(tournamentSeriesEditions)
        .values({ seriesId, editionNumber: 28, year: null, status: 'unconfirmed' })
        .returning({ id: tournamentSeriesEditions.id })

      const res = await findOrCreateEdition(testDb, {
        seriesId,
        editionNumber: 28,
        year: 2026,
        status: 'held',
        rawName: '第28回こばえちゃ山形酒田大会',
      })
      expect(res.created).toBe(false)
      expect(res.editionId).toBe(e!.id)
      const row = await testDb
        .select()
        .from(tournamentSeriesEditions)
        .where(eq(tournamentSeriesEditions.id, e!.id))
        .limit(1)
      expect(row[0]?.status).toBe('held')
      expect(row[0]?.year).toBe(2026)
      expect(row[0]?.rawName).toBe('第28回こばえちゃ山形酒田大会')
    })

    it('既存 held は unconfirmed(案内)で解決しても降格しない・year は上書きしない（R2）', async () => {
      const seriesId = await seedSeries('X大会')
      const [e] = await testDb
        .insert(tournamentSeriesEditions)
        .values({ seriesId, editionNumber: 1, year: 2020, status: 'held' })
        .returning({ id: tournamentSeriesEditions.id })
      await findOrCreateEdition(testDb, {
        seriesId,
        editionNumber: 1,
        year: 2099,
        status: 'unconfirmed',
      })
      const row = await testDb
        .select()
        .from(tournamentSeriesEditions)
        .where(eq(tournamentSeriesEditions.id, e!.id))
        .limit(1)
      expect(row[0]?.status).toBe('held')
      expect(row[0]?.year).toBe(2020)
    })
  })

  describe('suggestEditionFromName (R2 曖昧性)', () => {
    it('完全一致が単独なら matched=true＋正準名', async () => {
      await seedSeries('こばえちゃ山形酒田大会')
      const sug = await suggestEditionFromName(testDb, '第28回こばえちゃ山形酒田大会C級')
      expect(sug.matched).toBe(true)
      expect(sug.seriesName).toBe('こばえちゃ山形酒田大会')
      expect(sug.editionNumber).toBe(28)
    })

    it('完全一致が複数（name と他の alias 衝突）なら matched=false（曖昧）', async () => {
      await seedSeries('テスト大会')
      await testDb
        .insert(tournamentSeries)
        .values({ name: '別名持ち大会', aliases: ['テスト大会'], kind: 'individual' })
      const sug = await suggestEditionFromName(testDb, '第1回テスト大会A級')
      expect(sug.matched).toBe(false)
      expect(sug.editionNumber).toBe(1)
      // 系列名は解析した候補をそのまま（先頭候補へ silent 解決しない）
      expect(sug.seriesName).toBe('テスト大会')
    })
  })

  describe('findOrCreateSeries', () => {
    it('正規化一致する既存 series を返す（作成しない）', async () => {
      const id = await seedSeries('こばえちゃ山形酒田大会')
      const res = await findOrCreateSeries(testDb, { name: '★こばえちゃ 山形・酒田 大会' })
      expect(res.created).toBe(false)
      expect(res.seriesId).toBe(id)
    })
    it('allowCreate=true で無ければ新規作成', async () => {
      const res = await findOrCreateSeries(testDb, { name: '新設○○大会', allowCreate: true })
      expect(res.created).toBe(true)
      const row = await testDb
        .select()
        .from(tournamentSeries)
        .where(eq(tournamentSeries.id, res.seriesId))
        .limit(1)
      expect(row[0]?.name).toBe('新設○○大会')
    })
    it('未一致かつ allowCreate なし → throw（silent 作成しない・R3 blocker）', async () => {
      await expect(
        findOrCreateSeries(testDb, { name: 'どこにもない大会' }),
      ).rejects.toThrow(/新規系列として作成/)
      expect(await testDb.select().from(tournamentSeries)).toHaveLength(0)
    })
    it('完全一致が複数 → throw（曖昧・先頭へ silent 解決しない・R3 blocker）', async () => {
      await seedSeries('テスト大会')
      await testDb
        .insert(tournamentSeries)
        .values({ name: '別名持ち大会', aliases: ['テスト大会'], kind: 'individual' })
      await expect(
        findOrCreateSeries(testDb, { name: 'テスト大会', allowCreate: true }),
      ).rejects.toThrow(/複数の既存系列に一致/)
    })
    it('既存 series の kind と要求 kind が食い違うと throw（R5 should_fix）', async () => {
      await seedSeries('個人戦の大会') // seedSeries は kind=individual
      await expect(
        findOrCreateSeries(testDb, { name: '個人戦の大会', kind: 'team', allowCreate: true }),
      ).rejects.toThrow(/団体戦として紐付け/)
    })
    it('既存 series の kind と要求 kind が一致すれば解決する（R5）', async () => {
      const id = await seedSeries('個人戦の大会')
      const res = await findOrCreateSeries(testDb, { name: '個人戦の大会', kind: 'individual' })
      expect(res.seriesId).toBe(id)
      expect(res.created).toBe(false)
    })
  })

  describe('autoResolveEdition', () => {
    it('完全一致＋回次ありで find-or-create して link する', async () => {
      const seriesId = await seedSeries('こばえちゃ山形酒田大会')
      const res = await autoResolveEdition(testDb, {
        rawName: '第28回こばえちゃ山形酒田大会A級',
        year: 2027,
        status: 'held',
      })
      expect(res.linked).toBe(true)
      expect(res.reason).toBe('linked')
      expect(res.seriesId).toBe(seriesId)
      expect(res.editionNumber).toBe(28)
      expect(res.editionId).not.toBeNull()
    })

    it('回次が無ければ link しない（候補は返す）', async () => {
      await seedSeries('全日本かるた選手権大会')
      const res = await autoResolveEdition(testDb, {
        rawName: '全日本かるた選手権大会A級',
        status: 'held',
      })
      expect(res.linked).toBe(false)
      expect(res.reason).toBe('no-edition-number')
      expect(res.editionId).toBeNull()
    })

    it('系列が一致しなければ link しない（新規 series は auto 作成しない）', async () => {
      await seedSeries('こばえちゃ山形酒田大会')
      const res = await autoResolveEdition(testDb, {
        rawName: '第3回まったく別の大会B級',
        status: 'held',
      })
      expect(res.linked).toBe(false)
      expect(res.reason).toBe('no-match')
      expect(res.editionId).toBeNull()
      // series は増えていない
      const all = await testDb.select().from(tournamentSeries)
      expect(all).toHaveLength(1)
    })

    it('部分一致のみ（完全一致なし）なら link しない', async () => {
      await seedSeries('さがみ野大会')
      const res = await autoResolveEdition(testDb, {
        rawName: '第5回さがみ野B級', // 「さがみ野」⊂「さがみ野大会」= 包含(50) のみ
        status: 'held',
      })
      expect(res.linked).toBe(false)
      expect(res.reason).toBe('no-match')
    })
  })
})
