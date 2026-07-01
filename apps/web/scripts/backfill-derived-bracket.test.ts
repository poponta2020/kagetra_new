import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { tournamentParticipants } from '@kagetra/shared/schema'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { main } from './backfill-derived-bracket'

// backfill は独自の pg Pool を DATABASE_URL から開く。vitest.setup が DATABASE_URL を
// テスト DB に固定しているため、testDb と同じ DB に接続する（override:false の dotenv は
// これを上書きしない）。stdout はテスト出力を汚さないよう握りつぶす。
beforeEach(async () => {
  await truncateAll()
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

afterAll(async () => {
  vi.restoreAllMocks()
  await closeTestDb()
})

type PMatch = ParsedResultPayload['classes'][number]['participants'][number]['matches'][number]
function mm(
  round: number,
  roundLabel: string | null,
  opponentName: string | null,
  result: 'win' | 'lose',
): PMatch {
  return { round, roundLabel, opponentName, scoreDiff: null, result, status: 'normal' }
}
function part(
  name: string,
  finalRank: string | null,
  matches: PMatch[],
): ParsedResultPayload['classes'][number]['participants'][number] {
  return {
    seqNo: null,
    name,
    nameKana: null,
    affiliation: null,
    prefecture: null,
    dan: null,
    memberNo: null,
    finalRank,
    matches,
  }
}

/** 導出可能な A 級（優勝/準優勝/ベスト4×2）＋ 導出不能な B 級（リーグ）を seed。 */
function seedPayload(): ParsedResultPayload {
  return {
    parserVersion: '1.0.0',
    classes: [
      {
        className: 'A級',
        grade: 'A',
        sheetName: null,
        participants: [
          part('王者', '優勝', [mm(1, '準決勝', '銅子', 'win'), mm(2, '決勝', '次点', 'win')]),
          part('次点', '準優勝', [mm(1, '準決勝', '銅男', 'win'), mm(2, '決勝', '王者', 'lose')]),
          part('銅子', null, [mm(1, '準決勝', '王者', 'lose')]),
          part('銅男', null, [mm(1, '準決勝', '次点', 'lose')]),
        ],
      },
      {
        className: 'B級',
        grade: 'B',
        sheetName: null,
        participants: [
          part('総当X', '優勝', [mm(1, '1回戦', '総当Y', 'win'), mm(3, '3回戦', '総当Z', 'lose')]),
          part('総当Y', '2位', [mm(1, '1回戦', '総当X', 'lose'), mm(2, '2回戦', '総当Z', 'win')]),
          part('総当Z', '3位', [mm(2, '2回戦', '総当Y', 'lose'), mm(3, '3回戦', '総当X', 'win')]),
        ],
      },
    ],
  }
}

async function seedAndClearBrackets() {
  await testDb.transaction(async (tx) =>
    materializeResultDraft(tx, seedPayload(), {
      tournamentName: 'backfill検証大会',
      eventDate: '2026-06-10',
      venue: null,
      sourceResultDraftId: 1,
    }),
  )
  // 「derived_bracket 列が無かった頃のロード」を再現するため一旦全て null に戻す。
  await testDb.update(tournamentParticipants).set({ derivedBracket: null })
}

async function bracketByName(): Promise<Map<string, number | null>> {
  const rows = await testDb
    .select({ name: tournamentParticipants.name, b: tournamentParticipants.derivedBracket })
    .from(tournamentParticipants)
  return new Map(rows.map((r) => [r.name, r.b]))
}

describe('backfill-derived-bracket', () => {
  it('導出可能級のみ bracket を埋める（優勝1/準優勝2/ベスト4）・非導出級は null のまま', async () => {
    await seedAndClearBrackets()

    const summary = await main([])
    expect(summary.derivableParticipants).toBe(4)
    expect(summary.champions).toBe(1)
    expect(summary.nyusho).toBe(4)
    expect(summary.changed).toBe(4)
    expect(summary.updated).toBe(4)

    const b = await bracketByName()
    expect(b.get('王者')).toBe(1)
    expect(b.get('次点')).toBe(2)
    expect(b.get('銅子')).toBe(4)
    expect(b.get('銅男')).toBe(4)
    // 導出不能な B 級は null のまま（final_rank フォールバック元）。
    expect(b.get('総当X')).toBeNull()
    expect(b.get('総当Y')).toBeNull()
    expect(b.get('総当Z')).toBeNull()
  })

  it('冪等: 2 回目は変更 0 件', async () => {
    await seedAndClearBrackets()
    await main([])
    const second = await main([])
    expect(second.changed).toBe(0)
    expect(second.updated).toBe(0)
  })

  it('--dry-run は件数を報告するが DB を変更しない', async () => {
    await seedAndClearBrackets()

    const summary = await main(['--dry-run'])
    expect(summary.dryRun).toBe(true)
    expect(summary.changed).toBe(4) // 4 件が変更予定
    expect(summary.updated).toBe(0) // だが書き込まない

    // DB は依然として全 null（materialize 後に clear したまま）。
    const b = await bracketByName()
    for (const v of b.values()) expect(v).toBeNull()
  })

  it('既存値が誤っていれば正しい bracket に是正する（IS DISTINCT FROM）', async () => {
    await seedAndClearBrackets()
    // 王者に誤った bracket(=8) を入れておく → backfill が 1 に是正する。
    await testDb
      .update(tournamentParticipants)
      .set({ derivedBracket: 8 })
      .where(sql`${tournamentParticipants.name} = '王者'`)

    const summary = await main([])
    // 王者(8→1) と他3人(null→2/4/4) の計4件が変更対象。
    expect(summary.changed).toBe(4)
    const b = await bracketByName()
    expect(b.get('王者')).toBe(1)
  })
})
