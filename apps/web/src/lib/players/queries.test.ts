import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { tournamentParticipants } from '@kagetra/shared/schema'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { getPlayerName, getPlayerRecord, searchPlayers } from './queries'

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
    // player 行は所属を持たない（常に null）が、検索結果は直近大会の participant
    // スナップショットの所属を出す（戦績詳細ヘッダと一致）。
    expect(results[0]!.affiliation).toBe('札幌')
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

  it('複数大会で所属が変わる場合、直近の大会（event_date 最新）の所属を返す', async () => {
    const part = (affiliation: string | null) => ({
      seqNo: 1,
      name: '移籍太郎',
      nameKana: null,
      affiliation,
      prefecture: null,
      dan: null,
      memberNo: null,
      finalRank: null,
      matches: [],
    })
    // 古い大会（札幌）→ 新しい大会（東京）→ 開催日 null の大会（どこか会）を
    // この順で投入（= どこか会が最大 id）。直近は event_date 最新の「東京」で、
    // 開催日 null は NULLS LAST で直近扱いしない（id 降順だけなら誤って「どこか会」を
    // 拾ってしまうのを弾く）。同名なので materialize で同一 player に名寄せされる。
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('札幌')])] },
      { name: '古い大会', eventDate: '2024-01-01' },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('東京')])] },
      { name: '新しい大会', eventDate: '2026-05-01' },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('どこか会')])] },
      { name: '日付不明大会', eventDate: null },
    )

    const results = await searchPlayers('移籍太郎')
    expect(results).toHaveLength(1)
    expect(results[0]!.affiliation).toBe('東京')
    expect(results[0]!.participationCount).toBe(3)
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

describe('searchPlayers — 拡張フィールド（現級 / 最終出場 / 結果 / 並び順）', () => {
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

  const part = (
    name: string,
    opts: { affiliation?: string | null; finalRank?: string | null; matches?: Mt[] } = {},
  ): Part => ({
    seqNo: 1,
    name,
    nameKana: null,
    affiliation: opts.affiliation ?? null,
    prefecture: null,
    dan: null,
    memberNo: null,
    finalRank: opts.finalRank ?? null,
    matches: opts.matches ?? [],
  })

  it('bracket 導出できる最終出場：現級・最終出場（日/大会名）・結果を bracket ラベルで返す', async () => {
    // 4 人シングルイリミ A 級（準決勝→決勝）。王者=優勝(1) / 三席=準優勝(2) / 次点・四席=ベスト4(4)。
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [
          classWith('A級', 'A', [
            part('王者太郎', { matches: [mt(1, '準決勝', '次点太郎', 5, 'win'), mt(2, '決勝', '三席太郎', 3, 'win')] }),
            part('三席太郎', { matches: [mt(1, '準決勝', '四席太郎', 7, 'win'), mt(2, '決勝', '王者太郎', 3, 'lose')] }),
            part('次点太郎', { matches: [mt(1, '準決勝', '王者太郎', 5, 'lose')] }),
            part('四席太郎', { matches: [mt(1, '準決勝', '三席太郎', 7, 'lose')] }),
          ]),
        ],
      },
      { name: '選手権大会', eventDate: '2026-05-03' },
    )

    const champ = (await searchPlayers('王者太郎'))[0]!
    expect(champ.currentGrade).toBe('A')
    expect(champ.lastEventDate).toBe('2026-05-03')
    expect(champ.lastTournamentName).toBe('選手権大会')
    expect(champ.lastResult).toBe('優勝') // derived_bracket=1

    expect((await searchPlayers('三席太郎'))[0]!.lastResult).toBe('準優勝') // 2
    expect((await searchPlayers('次点太郎'))[0]!.lastResult).toBe('ベスト4') // 4
  })

  it('導出不能（リーグ）の最終出場は生 final_rank を lastResult にフォールバック', async () => {
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [
          classWith('B級', 'B', [
            part('リーグ次郎', {
              finalRank: '3位',
              matches: [mt(1, '予選リーグ', '甲', 2, 'win'), mt(2, '予選リーグ', '乙', 1, 'lose')],
            }),
          ]),
        ],
      },
      { name: 'リーグ大会', eventDate: '2026-04-01' },
    )
    const r = (await searchPlayers('リーグ次郎'))[0]!
    expect(r.currentGrade).toBe('B')
    expect(r.lastResult).toBe('3位') // bracket 導出不能 → 生 final_rank
  })

  it('bracket も final_rank も無い最終出場は lastResult=null（記録なし）', async () => {
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('記録無子')])] },
      { name: '小さな大会', eventDate: '2026-02-02' },
    )
    const r = (await searchPlayers('記録無子'))[0]!
    expect(r.lastResult).toBeNull()
    expect(r.lastEventDate).toBe('2026-02-02')
    expect(r.lastTournamentName).toBe('小さな大会')
  })

  it('開催日 null の最終出場は lastEventDate=null（開催日不明）でも他フィールドは返る', async () => {
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('C級', 'C', [part('日付無男', { finalRank: '優勝' })])] },
      { name: '日付不明大会', eventDate: null },
    )
    const r = (await searchPlayers('日付無男'))[0]!
    expect(r.lastEventDate).toBeNull()
    expect(r.lastTournamentName).toBe('日付不明大会')
    expect(r.currentGrade).toBe('C')
    expect(r.lastResult).toBe('優勝') // 生 final_rank（無試合＝導出不能）
  })

  it('直近参加の grade が null でも currentGrade は遡って非 null を採用し、last* は絶対的直近を指す', async () => {
    // 古い方＝B 級（grade B）、新しい方＝級不明（grade null）。同名なので同一 player に名寄せ。
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('B級', 'B', [part('遡上太郎', { affiliation: '旧会' })])] },
      { name: '旧年大会', eventDate: '2024-01-01' },
    )
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [classWith('級別なし', null, [part('遡上太郎', { affiliation: '新会', finalRank: 'ベスト8' })])],
      },
      { name: '新年大会', eventDate: '2026-06-01' },
    )

    const r = (await searchPlayers('遡上太郎'))[0]!
    expect(r.participationCount).toBe(2)
    expect(r.currentGrade).toBe('B') // 直近（新年・grade null）を飛ばして遡って非 null
    expect(r.lastEventDate).toBe('2026-06-01') // 絶対的直近＝新年大会
    expect(r.lastTournamentName).toBe('新年大会')
    expect(r.affiliation).toBe('新会') // 直近の所属スナップショット
    expect(r.lastResult).toBe('ベスト8') // 生 final_rank（級不明＝導出不能）
  })

  it('並びは最終出場が新しい順（NULLS LAST）＝現役が上', async () => {
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('並太新')])] },
      { name: '2026大会', eventDate: '2026-03-01' },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('並太古')])] },
      { name: '2020大会', eventDate: '2020-03-01' },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('並太無')])] },
      { name: '日付なし大会', eventDate: null },
    )
    const names = (await searchPlayers('並太')).map((r) => r.displayName)
    expect(names).toEqual(['並太新', '並太古', '並太無'])
  })

  it('同じ最終出場日のタイブレークは出場大会数の多い順', async () => {
    // 多回タイ＝昔(2023)＋直近同日(2025-05-01) で 2 出場、少回タイ＝直近同日のみ 1 出場。
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('多回タイ')])] },
      { name: '昔の大会', eventDate: '2023-01-01' },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('多回タイ'), part('少回タイ')])] },
      { name: '直近同日大会', eventDate: '2025-05-01' },
    )
    const names = (await searchPlayers('回タイ')).map((r) => r.displayName)
    expect(names).toEqual(['多回タイ', '少回タイ'])
  })

  it('開催日不明グループは常に最後尾で、その中だけ出場大会数の多い順（日付ありは追い越されない）', async () => {
    // 日付ソ順＝開催日あり(2020・1出場)。不明多ソ順＝開催日 null 2 大会で 2 出場、
    // 不明少ソ順＝開催日 null 1 大会で 1 出場。期待順＝日付あり（少出場でも先頭）→
    // 開催日不明の中を出場大会数降順（多→少）。null 行が participationCount で日付あり行を
    // 追い越さないことを固定する（Codex R1 should_fix）。
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('日付ソ順')])] },
      { name: '日付あり大会', eventDate: '2020-01-01' },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('不明多ソ順'), part('不明少ソ順')])] },
      { name: '無日付A大会', eventDate: null },
    )
    await seedTournament(
      { parserVersion: '1.0.0', classes: [classWith('D級', 'D', [part('不明多ソ順')])] },
      { name: '無日付B大会', eventDate: null },
    )
    const rows = await searchPlayers('ソ順')
    expect(rows.map((r) => r.displayName)).toEqual(['日付ソ順', '不明多ソ順', '不明少ソ順'])
    // 日付ソ順は 1 出場でも、開催日不明（2 出場）より上（NULLS LAST 主キー）。
    expect(rows[0]!.participationCount).toBe(1)
    expect(rows[0]!.lastEventDate).toBe('2020-01-01')
    expect(rows[1]!.participationCount).toBe(2) // 不明多＝null 群の中で出場数最多が先頭
    expect(rows[1]!.lastEventDate).toBeNull()
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

  const p = (
    seqNo: number,
    name: string,
    matches: Mt[],
    affiliation: string | null = null,
  ): Part => ({
    seqNo,
    name,
    nameKana: null,
    affiliation,
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
        p(2, 'B太郎', [mt(1, '準決勝', 'A太郎', 5, 'lose')], '東京A会'),
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
    expect(part.matches[0]!.opponentAffiliation).toBe('東京A会')
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

  it('リーグ戦（通常ラベルで全勝）は級ゲートで導出抑止＝final_rank フォールバック（Codex R3 blocker）', async () => {
    // 4人総当たり(3R)。AA は 3-0 で最終 round まで全勝＝本人列だけ見ると優勝に見えるが、
    // 級全体の敗北数(6) ≠ 参加者-1(3) なのでシングルイリミでない → 級単位で導出抑止。
    const rr: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        classWith('A級', 'A', [
          pRank(1, 'AA太郎', '優勝', [
            mt(1, '1回戦', 'BB太郎', 5, 'win'),
            mt(2, '2回戦', 'CC太郎', 4, 'win'),
            mt(3, '3回戦', 'DD太郎', 6, 'win'),
          ]),
          p(2, 'BB太郎', [
            mt(1, '1回戦', 'AA太郎', 5, 'lose'),
            mt(2, '2回戦', 'DD太郎', 3, 'win'),
            mt(3, '3回戦', 'CC太郎', 2, 'win'),
          ]),
          p(3, 'CC太郎', [
            mt(1, '1回戦', 'DD太郎', 7, 'win'),
            mt(2, '2回戦', 'AA太郎', 4, 'lose'),
            mt(3, '3回戦', 'BB太郎', 2, 'lose'),
          ]),
          p(4, 'DD太郎', [
            mt(1, '1回戦', 'CC太郎', 7, 'lose'),
            mt(2, '2回戦', 'BB太郎', 3, 'lose'),
            mt(3, '3回戦', 'AA太郎', 6, 'lose'),
          ]),
        ]),
      ],
    }
    await seedTournament(rr, { name: '総当たり大会', eventDate: '2026-06-01' })
    const rec = (await getPlayerRecord((await searchPlayers('AA太郎'))[0]!.id))!
    const part = rec.participations[0]!
    expect(part.rankBracket).toBeNull() // 級ゲートで導出されていない
    expect(part.rank).toBe('優勝') // final_rank フォールバックで表示はされる
    expect(rec.championships).toBe(0) // 導出ベース集計には入らない
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

  // 単一ソース不変条件（§4.1）: materialize が保存した derived_bracket は、戦績詳細
  // (getPlayerRecord) が同じ生データから導出する rankBracket と参加者ごとに完全一致する。
  // 導出可能級・非導出級（総当たり）・「導出可能だが個別導出が null になる異常級（0 試合
  // 参加者を含む）」を混在させ、乖離が無いことをピン留めする。これにより「一部だけ保存され
  // 得る」= partial は設計どおり（戦績詳細も同じフォールバックをする）＝汚染ではないことを担保。
  it('保存 derived_bracket は getPlayerRecord の rankBracket と参加者ごとに一致する', async () => {
    // 2人が正しく決勝を戦い、3人目は試合記録なし（棄権/未記録）。級は導出可能だが
    // 「無試合」だけ個別 derivePlacement が null になる（partial ケース）。
    const anomalous: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        classWith('D級', 'D', [
          p(1, '半端優勝', [mt(1, '決勝', '半端準V', 5, 'win')]),
          p(2, '半端準V', [mt(1, '決勝', '半端優勝', 5, 'lose')]),
          p(3, '無試合', []),
        ]),
      ],
    }
    // 非導出級（3人総当たり: 敗北3 ≠ 参加者-1）。全員 rankBracket=null になるべき。
    const league: ParsedResultPayload = {
      parserVersion: '1.0.0',
      classes: [
        classWith('B級', 'B', [
          pRank(1, '総A', '優勝', [mt(1, '1回戦', '総B', 2, 'win'), mt(3, '3回戦', '総C', 1, 'lose')]),
          pRank(2, '総B', '2位', [mt(1, '1回戦', '総A', 2, 'lose'), mt(2, '2回戦', '総C', 3, 'win')]),
          pRank(3, '総C', '3位', [mt(2, '2回戦', '総B', 3, 'lose'), mt(3, '3回戦', '総A', 1, 'win')]),
        ]),
      ],
    }
    await seedTournament(bracket, { name: '選手権', eventDate: '2026-05-03' })
    await seedTournament(league, { name: '総当たり大会', eventDate: '2026-06-01' })
    await seedTournament(anomalous, { name: '半端大会', eventDate: '2026-07-01' })

    // 全 participant の保存 derived_bracket を読み、その player の戦績詳細と突き合わせる。
    const parts = await testDb
      .select({
        id: tournamentParticipants.id,
        name: tournamentParticipants.name,
        playerId: tournamentParticipants.playerId,
        stored: tournamentParticipants.derivedBracket,
      })
      .from(tournamentParticipants)
    expect(parts.length).toBeGreaterThan(0)

    const cache = new Map<number, Awaited<ReturnType<typeof getPlayerRecord>>>()
    for (const part of parts) {
      const pid = part.playerId
      expect(pid).not.toBeNull()
      if (!cache.has(pid!)) cache.set(pid!, await getPlayerRecord(pid!))
      const rec = cache.get(pid!)!
      const view = rec!.participations.find((v) => v.participantId === part.id)!
      // 保存値 === 戦績詳細の参加者ごと導出値（乖離ゼロ）。
      expect(view.rankBracket).toBe(part.stored)
    }

    // partial ケースの具体値: 「無試合」だけ null、他2人は 1/2 が保存される（設計どおり）。
    const byName = new Map(parts.map((r) => [r.name, r.stored]))
    expect(byName.get('半端優勝')).toBe(1)
    expect(byName.get('半端準V')).toBe(2)
    expect(byName.get('無試合')).toBeNull()
  })
})

describe('getPlayerName', () => {
  it('表示名を引く / 存在しない id は null', async () => {
    await seedTournament(
      {
        parserVersion: '1.0.0',
        classes: [
          classWith('D級', 'D', [
            {
              seqNo: 1,
              name: '戻る太郎',
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
    const player = (await searchPlayers('戻る太郎'))[0]!
    expect(await getPlayerName(player.id)).toBe('戻る太郎')
    expect(await getPlayerName(999_999)).toBeNull()
  })
})
