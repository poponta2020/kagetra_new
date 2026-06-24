import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { players } from '@kagetra/shared/schema'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { materializeResultDraft } from '@/lib/result-import/materialize'
import { recomputePlayerDisplayNames } from './recompute-display-name'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

/**
 * A bare participant with a single name. affiliation is left null so that every
 * spelling variant of the same name resolves to ONE player via the
 * (normalized_name, affiliation) get-or-create key (normalizePlayerName folds
 * 山﨑→山崎 / 髙橋→高橋, so the variant and plain forms share a normalized key).
 */
function participant(
  seqNo: number,
  name: string,
): ParsedResultPayload['classes'][number]['participants'][number] {
  return {
    seqNo,
    name,
    nameKana: null,
    affiliation: null,
    prefecture: null,
    dan: null,
    memberNo: null,
    finalRank: null,
    matches: [],
  }
}

/**
 * Seed one tournament via the real materialize path (separate tx per call, like
 * production where each draft approval is its own tx). The FIRST tournament that
 * introduces a player fixes display_name = that raw name (first-wins) — exactly
 * the state recompute is meant to correct.
 */
async function seedTournament(opts: {
  name: string
  eventDate: string | null
  classes: { className: string; participants: string[] }[]
}) {
  const payload: ParsedResultPayload = {
    parserVersion: '1.0.0',
    classes: opts.classes.map((c) => ({
      className: c.className,
      grade: null,
      sheetName: null,
      participants: c.participants.map((n, i) => participant(i + 1, n)),
    })),
  }
  return testDb.transaction((tx) =>
    materializeResultDraft(tx, payload, {
      tournamentName: opts.name,
      eventDate: opts.eventDate,
      venue: null,
      sourceResultDraftId: 1,
    }),
  )
}

async function getPlayer(id: number) {
  const rows = await testDb.select().from(players).where(eq(players.id, id))
  return rows[0]!
}

describe('recomputePlayerDisplayNames', () => {
  it('A1: 最頻表記を採用する（山﨑×2 / 山崎×1 → 山﨑）', async () => {
    // 大会1: 「山﨑」を2回出場（2クラスとも同一 player に名寄せされる）
    await seedTournament({
      name: '大会1',
      eventDate: '2026-01-01',
      classes: [
        { className: 'D級', participants: ['山﨑'] },
        { className: 'E級', participants: ['山﨑'] },
      ],
    })
    // 大会2: 「山崎」を1回。display_name は first-wins で「山﨑」のまま。
    await seedTournament({
      name: '大会2',
      eventDate: '2026-02-01',
      classes: [{ className: 'D級', participants: ['山崎'] }],
    })

    // 名寄せされて player は1行。id は RESTART IDENTITY で 1。
    const all = await testDb.select().from(players)
    expect(all).toHaveLength(1)
    const id = all[0]!.id

    const updated = await recomputePlayerDisplayNames(testDb, [id])
    expect(updated).toBe(0) // 既に first-wins で「山﨑」= 最頻なので変化なし

    expect((await getPlayer(id)).displayName).toBe('山﨑')
  })

  it('A1b: first-wins が少数派なら最頻表記へ更新する（山崎が先勝→山﨑が最頻）', async () => {
    // 大会1: 「山崎」が先に1回入り display_name = 「山崎」(first-wins・少数派)
    await seedTournament({
      name: '大会1',
      eventDate: '2026-01-01',
      classes: [{ className: 'D級', participants: ['山崎'] }],
    })
    // 大会2: 「山﨑」を2回 → 最頻は「山﨑」
    await seedTournament({
      name: '大会2',
      eventDate: '2026-02-01',
      classes: [
        { className: 'D級', participants: ['山﨑'] },
        { className: 'E級', participants: ['山﨑'] },
      ],
    })

    const id = (await testDb.select().from(players))[0]!.id
    expect((await getPlayer(id)).displayName).toBe('山崎') // first-wins

    const updated = await recomputePlayerDisplayNames(testDb, [id])
    expect(updated).toBe(1)
    expect((await getPlayer(id)).displayName).toBe('山﨑')
  })

  it('A2: 同数なら旧字/異体字を優先する（髙橋×1 / 高橋×1 → 髙橋）', async () => {
    // 大会1: 「高橋」が先勝 → first-wins display_name = 「高橋」(plain)
    await seedTournament({
      name: '大会1',
      eventDate: '2026-01-01',
      classes: [{ className: 'D級', participants: ['高橋'] }],
    })
    // 大会2: 「髙橋」(variant) を1回。cnt は 1:1 の tie。
    await seedTournament({
      name: '大会2',
      eventDate: '2026-02-01',
      classes: [{ className: 'D級', participants: ['髙橋'] }],
    })

    const id = (await testDb.select().from(players))[0]!.id
    expect((await getPlayer(id)).displayName).toBe('高橋') // first-wins(plain)

    const updated = await recomputePlayerDisplayNames(testDb, [id])
    expect(updated).toBe(1)
    // tie を is_variant DESC で割る → variant の「髙橋」が勝つ
    expect((await getPlayer(id)).displayName).toBe('髙橋')
  })

  it('A3: tie 同士が両方 variant なら最新 event_date の表記', async () => {
    // 「渡邉」と「渡邊」はどちらも normalizePlayerName で「渡辺」に畳まれる
    // = 両方 variant。cnt 1:1 / is_variant true:true の二重 tie。
    // 大会1(古い): 「渡邉」/ 大会2(新しい): 「渡邊」→ 最新 event_date の「渡邊」。
    await seedTournament({
      name: '大会1',
      eventDate: '2025-01-01',
      classes: [{ className: 'D級', participants: ['渡邉'] }],
    })
    await seedTournament({
      name: '大会2',
      eventDate: '2026-06-01',
      classes: [{ className: 'D級', participants: ['渡邊'] }],
    })

    const id = (await testDb.select().from(players))[0]!.id
    expect((await getPlayer(id)).displayName).toBe('渡邉') // first-wins(古い)

    const updated = await recomputePlayerDisplayNames(testDb, [id])
    expect(updated).toBe(1)
    // cnt tie + is_variant tie → latest DESC で新しい「渡邊」を採用
    expect((await getPlayer(id)).displayName).toBe('渡邊')
  })

  it('A4: 変化なしの player は更新されない（updated_at 不変）', async () => {
    // first-wins が既に最頻表記と一致するケース。
    await seedTournament({
      name: '大会1',
      eventDate: '2026-01-01',
      classes: [
        { className: 'D級', participants: ['田中'] },
        { className: 'E級', participants: ['田中'] },
      ],
    })

    const id = (await testDb.select().from(players))[0]!.id
    const before = await getPlayer(id)
    expect(before.displayName).toBe('田中')

    const updated = await recomputePlayerDisplayNames(testDb, [id])
    expect(updated).toBe(0) // IS DISTINCT FROM ガードで no-op

    const after = await getPlayer(id)
    expect(after.displayName).toBe('田中')
    // updated_at が触られていない（変化分のみ UPDATE）
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('空配列を渡したら SQL を実行せず 0 を返す（全件更新の事故防止）', async () => {
    await seedTournament({
      name: '大会1',
      eventDate: '2026-01-01',
      classes: [{ className: 'D級', participants: ['佐藤'] }],
    })
    const id = (await testDb.select().from(players))[0]!.id
    const before = await getPlayer(id)

    const updated = await recomputePlayerDisplayNames(testDb, [])
    expect(updated).toBe(0)

    // 全件更新の事故が起きていない（updated_at 不変）
    const after = await getPlayer(id)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('playerIds 無指定なら全 player を backfill する', async () => {
    // 別所属で2人の player を作り、両方 first-wins が少数派になるよう仕込む。
    await seedTournament({
      name: '大会A',
      eventDate: '2026-01-01',
      classes: [
        { className: 'D級', participants: ['山崎'] }, // player1 first-wins=山崎
        { className: 'E級', participants: ['髙橋'] }, // player2 first-wins=髙橋
      ],
    })
    await seedTournament({
      name: '大会B',
      eventDate: '2026-02-01',
      classes: [
        { className: 'D級', participants: ['山﨑', '山﨑'] }, // 山﨑が最頻
        { className: 'E級', participants: ['高橋', '高橋'] }, // 高橋が最頻
      ],
    })

    const updated = await recomputePlayerDisplayNames(testDb) // 無指定=全件
    expect(updated).toBe(2)

    const rows = await testDb.select().from(players)
    const byNormalized = new Map(rows.map((r) => [r.normalizedName, r.displayName]))
    expect(byNormalized.get('山崎')).toBe('山﨑')
    expect(byNormalized.get('高橋')).toBe('高橋')
  })
})
