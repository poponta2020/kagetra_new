import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createMailMessage, createTournamentDraft } from '@/test-utils/seed'
import { clusterEventsByEntryGroup } from './entry-groups'

/**
 * AC-2（SQL 側）: migration 0045 の backfill が使うクラスタ式
 * （`GROUP BY tournament_draft_id, entry_deadline`）が、規則の正である純関数
 * `clusterEventsByEntryGroup` と**同じ結果**になることを実 DB で固定する。
 *
 * なぜ必要か: vitest の global-setup は `drizzle-kit push --force` で**最終スキーマを
 * 直接 push する**ため、migration ファイルの backfill SQL はテストスイートで一度も
 * 実行されない。規則が plpgsql と TS の2箇所にある以上、意味論のズレ
 * （特に `IS NOT DISTINCT FROM` / `GROUP BY` の NULL 同値）はここでしか検出できない。
 */

interface Shape {
  title: string
  tournamentDraftId: number | null
  entryDeadline: string | null
}

/** migration 0045 の backfill と同じクラスタ式で、draft 由来イベントを束ねる。 */
async function clusterViaSql(): Promise<string[][]> {
  const result = await testDb.execute<{ titles: string[] }>(sql`
    SELECT array_agg(title ORDER BY title) AS titles
      FROM events
     WHERE tournament_draft_id IS NOT NULL
     GROUP BY tournament_draft_id, entry_deadline
     ORDER BY min(title)
  `)
  return result.rows.map((r) => r.titles)
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('backfill クラスタ式（SQL）と純関数の一致 — AC-2', () => {
  it('多摩5件＋秋田2件＋NULL締切2件で、SQL と純関数が同じ束ね方になる', async () => {
    // tournament_drafts.message_id は UNIQUE なので、draft ごとに別のメールを作る。
    const tamaMail = await createMailMessage({})
    const akitaMail = await createMailMessage({})
    const tama = await createTournamentDraft({ messageId: tamaMail.id })
    const akita = await createTournamentDraft({ messageId: akitaMail.id })

    const shapes: Shape[] = [
      { title: '多摩A', tournamentDraftId: tama.id, entryDeadline: '2026-07-11' },
      { title: '多摩B', tournamentDraftId: tama.id, entryDeadline: '2026-07-11' },
      { title: '多摩C', tournamentDraftId: tama.id, entryDeadline: '2026-07-05' },
      { title: '多摩D', tournamentDraftId: tama.id, entryDeadline: '2026-07-05' },
      { title: '多摩E', tournamentDraftId: tama.id, entryDeadline: '2026-07-05' },
      { title: '秋田ABCD', tournamentDraftId: akita.id, entryDeadline: '2026-07-26' },
      { title: '秋田DE', tournamentDraftId: akita.id, entryDeadline: '2026-08-30' },
      // 同一 draft・締切 NULL 同士 → SQL の GROUP BY も NULL をまとめる。
      { title: '締切未定1', tournamentDraftId: akita.id, entryDeadline: null },
      { title: '締切未定2', tournamentDraftId: akita.id, entryDeadline: null },
    ]
    for (const s of shapes) {
      await createEvent({
        title: s.title,
        eventDate: '2026-09-01',
        tournamentDraftId: s.tournamentDraftId,
        entryDeadline: s.entryDeadline,
      })
    }

    const viaSql = (await clusterViaSql()).map((titles) => [...titles].sort())
    const viaFn = clusterEventsByEntryGroup(shapes)
      .map((c) => c.map((e) => e.title).sort())
    // 並び順に依存しない集合比較（クラスタの並びは ORDER BY min(title) と入力順で違いうる）。
    const norm = (groups: string[][]) =>
      groups.map((g) => g.join(',')).sort()

    expect(norm(viaSql)).toEqual(norm(viaFn))
    // 期待する形そのものも固定しておく（多摩→2・秋田→2＋NULL締切→1）。
    expect(norm(viaSql)).toEqual(
      norm([
        ['多摩A', '多摩B'],
        ['多摩C', '多摩D', '多摩E'],
        ['秋田ABCD'],
        ['秋田DE'],
        ['締切未定1', '締切未定2'],
      ]),
    )
  })

  it('IS NOT DISTINCT FROM は NULL 同士を一致とみなす（backfill の UPDATE 条件）', async () => {
    const result = await testDb.execute<{ null_eq: boolean; null_vs_value: boolean }>(sql`
      SELECT (NULL::date IS NOT DISTINCT FROM NULL::date) AS null_eq,
             (NULL::date IS NOT DISTINCT FROM DATE '2026-07-05') AS null_vs_value
    `)
    expect(result.rows[0]?.null_eq).toBe(true)
    expect(result.rows[0]?.null_vs_value).toBe(false)
  })

  it('draft 無しのイベントはクラスタ式の対象外（シングルトン扱い）', async () => {
    await createEvent({ title: '会内練習会', tournamentDraftId: null })
    await createEvent({ title: '女流BC', tournamentDraftId: null })

    // WHERE tournament_draft_id IS NOT NULL なので SQL 側の束ねには現れない。
    expect(await clusterViaSql()).toEqual([])
    // 純関数側では 1 件 1 クラスタ。
    expect(
      clusterEventsByEntryGroup([
        { title: '会内練習会', tournamentDraftId: null, entryDeadline: null },
        { title: '女流BC', tournamentDraftId: null, entryDeadline: null },
      ]).map((c) => c.length),
    ).toEqual([1, 1])
  })

  it('createEvent は既定でシングルトングループを自動生成する（AC-1）', async () => {
    const a = await createEvent({ title: 'A' })
    const b = await createEvent({ title: 'B' })

    expect(a.entryGroupId).toBeTypeOf('number')
    expect(b.entryGroupId).toBeTypeOf('number')
    expect(a.entryGroupId).not.toBe(b.entryGroupId)
  })

  it('entryGroupId を明示すれば複数イベントを同一グループに置ける', async () => {
    const first = await createEvent({ title: '多摩A' })
    const second = await createEvent({ title: '多摩B', entryGroupId: first.entryGroupId })

    expect(second.entryGroupId).toBe(first.entryGroupId)
  })
})
