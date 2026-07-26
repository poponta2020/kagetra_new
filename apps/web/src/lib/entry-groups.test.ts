import { describe, expect, it } from 'vitest'
import {
  clusterEventsByEntryGroup,
  deriveEntryGroupName,
  diffPropagatableFields,
  selectRepresentativeEvent,
} from './entry-groups'

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

describe('deriveEntryGroupName — AC-3 グループ表示名の導出', () => {
  it('「多摩A」+「多摩B」→「多摩AB」', () => {
    expect(deriveEntryGroupName(['多摩A', '多摩B'])).toBe('多摩AB')
  })

  it('3件の級文字も昇順で連結される（多摩C/D/E→多摩CDE）', () => {
    expect(deriveEntryGroupName(['多摩C', '多摩D', '多摩E'])).toBe('多摩CDE')
  })

  it('入力順が級の並びと逆でも昇順に整列される', () => {
    expect(deriveEntryGroupName(['多摩B', '多摩A'])).toBe('多摩AB')
  })

  it('同一タイトル複数日（大学生選手権×3）はそのまま畳まれる', () => {
    expect(deriveEntryGroupName(['大学生選手権', '大学生選手権', '大学生選手権'])).toBe(
      '大学生選手権',
    )
  })

  it('1件だけのグループはそのタイトル', () => {
    expect(deriveEntryGroupName(['多摩A'])).toBe('多摩A')
  })

  it('空配列は null', () => {
    expect(deriveEntryGroupName([])).toBeNull()
  })

  it('共通接頭辞が無い場合は導出不能で null（呼び出し側が代表イベントへフォールバック）', () => {
    expect(deriveEntryGroupName(['秋田ABCD', '多摩E'])).toBeNull()
  })

  it('共通接頭辞はあるが残りが級文字1文字でない場合は導出不能で null', () => {
    expect(deriveEntryGroupName(['多摩大会前半', '多摩大会後半'])).toBeNull()
  })

  it('残りが級文字だが2文字以上ある場合は導出不能で null', () => {
    expect(deriveEntryGroupName(['多摩AA', '多摩BB'])).toBeNull()
  })
})

describe('selectRepresentativeEvent — 代表イベント選定', () => {
  const TODAY = '2026-07-27'

  it('今日以降で最も開催日が近いイベントを選ぶ', () => {
    const result = selectRepresentativeEvent(
      [
        { id: 1, eventDate: '2026-08-10' },
        { id: 2, eventDate: '2026-08-01' },
        { id: 3, eventDate: '2026-06-01' }, // 過去
      ],
      TODAY,
    )
    expect(result?.id).toBe(2)
  })

  it('未来の候補が無ければ開催日が最新（過去の中で最大）のイベントを選ぶ', () => {
    const result = selectRepresentativeEvent(
      [
        { id: 1, eventDate: '2026-06-01' },
        { id: 2, eventDate: '2026-06-15' },
        { id: 3, eventDate: '2026-05-01' },
      ],
      TODAY,
    )
    expect(result?.id).toBe(2)
  })

  it('今日ちょうどのイベントは「今日以降」に含まれる', () => {
    const result = selectRepresentativeEvent(
      [
        { id: 1, eventDate: TODAY },
        { id: 2, eventDate: '2026-08-01' },
      ],
      TODAY,
    )
    expect(result?.id).toBe(1)
  })

  it('同着（同一開催日）は id 昇順で安定させる', () => {
    const result = selectRepresentativeEvent(
      [
        { id: 5, eventDate: '2026-08-01' },
        { id: 2, eventDate: '2026-08-01' },
      ],
      TODAY,
    )
    expect(result?.id).toBe(2)
  })

  it('空配列は null', () => {
    expect(selectRepresentativeEvent([], TODAY)).toBeNull()
  })
})

describe('diffPropagatableFields — 伝播対象フィールドの差分検出', () => {
  it('変更されたフィールドだけを返す', () => {
    const before = {
      entryDeadline: '2026-07-01',
      internalDeadline: '2026-06-25',
      paymentDeadline: null,
      lotteryDate: null,
      paymentMethod: '銀行振込',
      paymentInfo: null,
      entryMethod: 'メール',
    }
    const after = {
      ...before,
      entryDeadline: '2026-07-10', // 変更
      paymentMethod: '銀行振込', // 未変更
    }
    expect(diffPropagatableFields(before, after)).toEqual({ entryDeadline: '2026-07-10' })
  })

  it('null と未指定は同値として扱う（差分に出ない）', () => {
    const before = { entryDeadline: null }
    const after = {}
    expect(diffPropagatableFields(before, after)).toEqual({})
  })

  it('変更が無ければ空オブジェクト', () => {
    const same = { entryMethod: 'メール', paymentInfo: null }
    expect(diffPropagatableFields(same, { ...same })).toEqual({})
  })

  it('日固有フィールド（title 等）は対象外——型に含まれないため呼び出し側が渡せない', () => {
    // PropagatableFieldKey は entryDeadline/internalDeadline/paymentDeadline/lotteryDate/
    // paymentMethod/paymentInfo/entryMethod の7つのみ。コンパイル時に保証されるため
    // 実行時テストは不要（型テストとしてこのコメントを残す）。
    expect(diffPropagatableFields({}, {})).toEqual({})
  })
})
