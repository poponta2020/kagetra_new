import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { tournamentSeries, tournamentSeriesEditions } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  autoResolveEdition,
  buildEditionSuggestion,
  createConfirmedSeries,
  findOrCreateEdition,
  findOrCreateSeries,
  getSeriesForEditionLink,
  loadEditionSelectionData,
  normalizeForMatch,
  parseAnnouncementName,
  parseEditionNumber,
  parseSeriesName,
  rankSeriesCandidates,
  resolveEditionFromForm,
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
    // mail-ai-extract-refinements §3.2.11 / AC-58: 漢数字の回次。
    it('漢数字「第三回」を 3 にする', () => {
      expect(parseEditionNumber('第三回全国競技かるた杉並大会')).toBe(3)
    })
    it('位取りのある「第二十五回」を 25 にする', () => {
      expect(parseEditionNumber('第二十五回テスト大会')).toBe(25)
    })
    it('「第十回」を 10 にする', () => {
      expect(parseEditionNumber('第十回テスト大会')).toBe(10)
    })
    it('「第百五十回」を 150 にする', () => {
      expect(parseEditionNumber('第百五十回テスト大会')).toBe(150)
    })
    it('年式表記（九段大会2026-2）は従来どおり null', () => {
      expect(parseEditionNumber('九段大会2026-2')).toBeNull()
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
    // AC-58: 回次の値だけでなく**ラベルの除去**も漢数字に対応する。片方だけだと
    // 系列名候補に「第三回」が残り、既存系列と完全一致しなくなる。
    it('漢数字の第N回も落とす', () => {
      expect(parseSeriesName('第三回全国競技かるた杉並大会A級')).toBe(
        '全国競技かるた杉並大会',
      )
      expect(parseSeriesName('第二十五回テスト大会')).toBe('テスト大会')
    })
    it('「第N回」以外の漢数字は残す', () => {
      expect(parseSeriesName('三重県大会')).toBe('三重県大会')
      expect(parseSeriesName('第1回九段大会')).toBe('九段大会')
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
    it('漢数字でも回次と系列名候補が揃う', () => {
      expect(parseAnnouncementName('第三回全国競技かるた杉並大会A級')).toEqual({
        editionNumber: 3,
        seriesNameGuess: '全国競技かるた杉並大会',
      })
    })
  })

  /**
   * mail-ai-extract-refinements §3.2.9(a) / AC-45〜AC-47:
   * 初期選択の条件を「正規化完全一致が単独」→「名寄せ候補が 1 件だけ」へ緩和する。
   * tournament-entry-rosters §3.1・AC-1/AC-2 の上書き。
   */
  describe('buildEditionSuggestion', () => {
    const sugimani: SeriesRow = {
      id: 1,
      name: '全国競技かるた杉並大会',
      aliases: [],
      kind: 'individual',
      shortName: '杉並',
    }
    const kudan: SeriesRow = {
      id: 2,
      name: '九段',
      aliases: [],
      kind: 'individual',
      shortName: null,
    }
    const suginamiCity: SeriesRow = {
      id: 3,
      name: '杉並市民大会',
      aliases: [],
      kind: 'individual',
      shortName: '杉並市民',
    }

    it('部分一致でも候補が 1 件なら系列と通称を採用する', () => {
      const suggestion = buildEditionSuggestion('第3回杉並大会A級', [sugimani])
      expect(suggestion.seriesId).toBe(1)
      expect(suggestion.seriesShortName).toBe('杉並')
      // pre-fill する系列名は採用した系列の正準名（検索し直しても自分自身に当たる）。
      expect(suggestion.seriesName).toBe('全国競技かるた杉並大会')
      expect(suggestion.editionNumber).toBe(3)
      // matched は従来どおり「完全一致だったか」— 採用の条件ではない。
      expect(suggestion.matched).toBe(false)
    })

    it('候補 1 件でも通称が null なら通称は入れない', () => {
      const suggestion = buildEditionSuggestion('第1回九段A級', [kudan])
      expect(suggestion.seriesId).toBe(2)
      expect(suggestion.seriesShortName).toBeNull()
      expect(suggestion.matched).toBe(true)
    })

    it('候補 0 件なら未選択で通称も空', () => {
      const suggestion = buildEditionSuggestion('第1回鳳玉杯A級', [sugimani])
      expect(suggestion.seriesId).toBeNull()
      expect(suggestion.seriesShortName).toBeNull()
      expect(suggestion.seriesName).toBe('鳳玉杯')
    })

    it('部分一致が複数なら未選択で通称も空', () => {
      const suggestion = buildEditionSuggestion('第3回杉並A級', [
        sugimani,
        suginamiCity,
      ])
      expect(suggestion.seriesId).toBeNull()
      expect(suggestion.seriesShortName).toBeNull()
      expect(suggestion.seriesName).toBe('杉並')
    })

    it('完全一致が単独なら部分一致が他にあっても採用する（既存挙動の維持）', () => {
      const suggestion = buildEditionSuggestion('第3回杉並市民大会A級', [
        suginamiCity,
        { ...sugimani, name: '杉並市民大会選抜', shortName: '杉並選抜' },
      ])
      expect(suggestion.seriesId).toBe(3)
      expect(suggestion.seriesShortName).toBe('杉並市民')
      expect(suggestion.matched).toBe(true)
    })

    it('漢数字の案内でも系列を採用できる', () => {
      const suggestion = buildEditionSuggestion('第三回全国競技かるた杉並大会A級', [
        sugimani,
      ])
      expect(suggestion.seriesId).toBe(1)
      expect(suggestion.editionNumber).toBe(3)
      expect(suggestion.matched).toBe(true)
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

  async function seedSeries(
    name: string,
    aliases: string[] = [],
    shortName: string | null = null,
  ) {
    const [s] = await testDb
      .insert(tournamentSeries)
      .values({ name, aliases, kind: 'individual', shortName })
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
      const seriesId = await seedSeries('こばえちゃ山形酒田大会')
      const sug = await suggestEditionFromName(testDb, '第28回こばえちゃ山形酒田大会C級')
      expect(sug.matched).toBe(true)
      expect(sug.seriesId).toBe(seriesId)
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
      expect(sug.seriesId).toBeNull()
      expect(sug.editionNumber).toBe(1)
      // 系列名は解析した候補をそのまま（先頭候補へ silent 解決しない）
      expect(sug.seriesName).toBe('テスト大会')
    })

    it('系列一覧と候補を同じ取得結果から返す', async () => {
      const seriesId = await seedSeries('テスト大会')
      const data = await loadEditionSelectionData(testDb, '第2回テスト大会')
      expect(data.seriesOptions.map((series) => series.id)).toContain(seriesId)
      expect(data.suggestion.seriesId).toBe(seriesId)
      expect(data.suggestion.editionNumber).toBe(2)
    })

    it('系列一覧と初期候補に通称を載せる', async () => {
      const seriesId = await seedSeries('テスト大会', [], 'てすと')
      const data = await loadEditionSelectionData(testDb, '第2回テスト大会')
      expect(
        data.seriesOptions.find((series) => series.id === seriesId)?.shortName,
      ).toBe('てすと')
      expect(data.suggestion.seriesShortName).toBe('てすと')
    })
  })

  describe('approval-specific series selection', () => {
    it('既存系列 ID を検証して返す', async () => {
      const seriesId = await seedSeries('既存大会')
      await expect(
        getSeriesForEditionLink(testDb, { seriesId, kind: 'individual' }),
      ).resolves.toMatchObject({ id: seriesId, name: '既存大会' })
    })

    it('既存系列 ID の検証結果に通称を含める', async () => {
      const seriesId = await seedSeries('通称付き大会', [], 'つうしょう')
      await expect(
        getSeriesForEditionLink(testDb, { seriesId, kind: 'individual' }),
      ).resolves.toMatchObject({ id: seriesId, shortName: 'つうしょう' })
    })

    it('存在しない系列 ID は拒否する', async () => {
      await expect(
        getSeriesForEditionLink(testDb, { seriesId: 999999, kind: 'individual' }),
      ).rejects.toThrow(/見つかりません/)
    })

    it('系列 kind が承認対象と異なる場合は拒否する', async () => {
      const seriesId = await seedSeries('個人戦大会')
      await expect(
        getSeriesForEditionLink(testDb, { seriesId, kind: 'team' }),
      ).rejects.toThrow(/団体戦として紐付け/)
    })

    it('明示的新規作成でも既存正準名・別名との完全一致を拒否する', async () => {
      await seedSeries('既存大会', ['旧称大会'])
      await expect(
        createConfirmedSeries(testDb, { name: '★ 既存大会', kind: 'individual' }),
      ).rejects.toThrow(/検索結果から選択/)
      await expect(
        createConfirmedSeries(testDb, { name: '旧称大会', kind: 'individual' }),
      ).rejects.toThrow(/検索結果から選択/)
    })

    it('完全一致がない場合だけ新規系列を作る', async () => {
      const created = await createConfirmedSeries(testDb, {
        name: ' 新しい大会 ',
        kind: 'team',
      })
      expect(created).toMatchObject({ name: '新しい大会', kind: 'team' })
    })

    // §3.2.9(d) / AC-55, AC-56: 承認画面の通称を short_name として育てる。
    it('新規系列に通称を保存する', async () => {
      const created = await createConfirmedSeries(testDb, {
        name: '新設通称大会',
        kind: 'individual',
        shortName: ' 新設 ',
      })
      expect(created.shortName).toBe('新設')
      const row = await testDb
        .select()
        .from(tournamentSeries)
        .where(eq(tournamentSeries.id, created.id))
        .limit(1)
      expect(row[0]?.shortName).toBe('新設')
    })

    it('通称が空白のみ・未指定なら short_name は null', async () => {
      const blank = await createConfirmedSeries(testDb, {
        name: '空白通称大会',
        kind: 'individual',
        shortName: '   ',
      })
      expect(blank.shortName).toBeNull()
      const omitted = await createConfirmedSeries(testDb, {
        name: '通称なし大会',
        kind: 'individual',
      })
      expect(omitted.shortName).toBeNull()
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

  describe('resolveEditionFromForm (手動フォーム)', () => {
    it('link OFF → null', async () => {
      const fd = new FormData()
      const r = await resolveEditionFromForm(testDb, fd, {
        kind: 'individual',
        year: 2026,
        status: 'unconfirmed',
      })
      expect(r).toBeNull()
    })
    it('link ON + 既存系列 → 解決して editionId を返す', async () => {
      const seriesId = await seedSeries('テスト大会')
      const fd = new FormData()
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', 'テスト大会')
      fd.set('editionNumber', '5')
      const r = await resolveEditionFromForm(testDb, fd, {
        kind: 'individual',
        year: 2026,
        status: 'unconfirmed',
      })
      expect(r).not.toBeNull()
      const ed = await testDb
        .select()
        .from(tournamentSeriesEditions)
        .where(eq(tournamentSeriesEditions.id, r!))
        .limit(1)
      expect(ed[0]?.seriesId).toBe(seriesId)
      expect(ed[0]?.editionNumber).toBe(5)
    })
    it('link ON + 未一致 + 新規フラグなし → throw', async () => {
      const fd = new FormData()
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', '存在しない大会')
      fd.set('editionNumber', '1')
      await expect(
        resolveEditionFromForm(testDb, fd, { kind: 'individual', year: null, status: 'unconfirmed' }),
      ).rejects.toThrow(/新規系列として作成/)
    })
    it('link ON + 回次なし → throw', async () => {
      await seedSeries('テスト大会')
      const fd = new FormData()
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', 'テスト大会')
      await expect(
        resolveEditionFromForm(testDb, fd, { kind: 'individual', year: null, status: 'unconfirmed' }),
      ).rejects.toThrow(/回次/)
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
