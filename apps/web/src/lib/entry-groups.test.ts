import { describe, expect, it } from 'vitest'
import { clusterEventsByEntryGroup } from './entry-groups'

/**
 * AC-2: backfill のクラスタ規則。
 *
 * この純関数が規則の**正**で、migration 0045 の plpgsql と タスク7 の承認フォーム提案が
 * 同じ結果になることを期待している。SQL 側の意味論（`IS NOT DISTINCT FROM` の NULL 同値）は
 * `entry-groups.sql.test.ts` が実 DB で固定する。
 */

function titles(clusters: { title: string }[][]): string[][] {
  return clusters.map((c) => c.map((e) => e.title))
}

describe('clusterEventsByEntryGroup — AC-2 クラスタ規則', () => {
  it('多摩5件（同一 draft・締切2系統）→ 2グループ', () => {
    const clusters = clusterEventsByEntryGroup([
      { title: '多摩A', tournamentDraftId: 1, entryDeadline: '2026-07-11' },
      { title: '多摩B', tournamentDraftId: 1, entryDeadline: '2026-07-11' },
      { title: '多摩C', tournamentDraftId: 1, entryDeadline: '2026-07-05' },
      { title: '多摩D', tournamentDraftId: 1, entryDeadline: '2026-07-05' },
      { title: '多摩E', tournamentDraftId: 1, entryDeadline: '2026-07-05' },
    ])

    expect(titles(clusters)).toEqual([
      ['多摩A', '多摩B'],
      ['多摩C', '多摩D', '多摩E'],
    ])
  })

  it('秋田2件（同一 draft だが締切が違う）→ 2グループ', () => {
    const clusters = clusterEventsByEntryGroup([
      { title: '秋田ABCD', tournamentDraftId: 2, entryDeadline: '2026-07-26' },
      { title: '秋田DE', tournamentDraftId: 2, entryDeadline: '2026-08-30' },
    ])

    expect(titles(clusters)).toEqual([['秋田ABCD'], ['秋田DE']])
  })

  it('draft が違えば締切が同じでも別グループ', () => {
    const clusters = clusterEventsByEntryGroup([
      { title: '大会X', tournamentDraftId: 1, entryDeadline: '2026-07-11' },
      { title: '大会Y', tournamentDraftId: 2, entryDeadline: '2026-07-11' },
    ])

    expect(titles(clusters)).toEqual([['大会X'], ['大会Y']])
  })

  it('締切 NULL 同士は同一グループ（IS NOT DISTINCT FROM 相当）', () => {
    const clusters = clusterEventsByEntryGroup([
      { title: '締切未定1', tournamentDraftId: 3, entryDeadline: null },
      { title: '締切未定2', tournamentDraftId: 3, entryDeadline: null },
      { title: '締切あり', tournamentDraftId: 3, entryDeadline: '2026-07-01' },
    ])

    expect(titles(clusters)).toEqual([['締切未定1', '締切未定2'], ['締切あり']])
  })

  it('draft 無し（手動作成・移行データ）は1件1グループのシングルトン', () => {
    const clusters = clusterEventsByEntryGroup([
      { title: '会内練習会', tournamentDraftId: null, entryDeadline: null },
      { title: '女流BC', tournamentDraftId: null, entryDeadline: null },
      { title: '同締切でも別', tournamentDraftId: null, entryDeadline: '2026-07-01' },
    ])

    expect(titles(clusters)).toEqual([['会内練習会'], ['女流BC'], ['同締切でも別']])
  })

  it('入力順を保つ（クラスタの並びも各クラスタ内も）', () => {
    const clusters = clusterEventsByEntryGroup([
      { title: 'b', tournamentDraftId: 1, entryDeadline: '2026-07-05' },
      { title: 'a', tournamentDraftId: 1, entryDeadline: '2026-07-11' },
      { title: 'c', tournamentDraftId: 1, entryDeadline: '2026-07-05' },
    ])

    expect(titles(clusters)).toEqual([
      ['b', 'c'],
      ['a'],
    ])
  })

  it('空配列は空配列', () => {
    expect(clusterEventsByEntryGroup([])).toEqual([])
  })
})
