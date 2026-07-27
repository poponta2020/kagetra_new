import { describe, it, expect, vi, afterEach } from 'vitest'
import type { EntryBoardItem, AreaId, VisibleAreaId } from './entry-board-utils'
import {
  AREAS,
  baseDeadlineOf,
  classify,
  daysBetween,
  deadlineBadgeOf,
  displayName,
  groupAttendCount,
  groupBoard,
  groupDeadlineBadge,
  isAreaHot,
  isDue,
  isPinnedWhenCollapsed,
  pickRepresentativeDay,
  sortArea,
} from './entry-board-utils'

const TODAY = '2026-07-10'

/**
 * 未申込・締切前を既定値とする素の EntryBoardItem。
 *
 * `entryGroupId` の既定値は自分自身の `id`——各行が独立したシングルトン
 * グループになる（従来の「1行=1大会」相当。groupBoard の網羅テストが
 * そのまま使い回せる）。複数行を同じグループへまとめたいテスト（タスク6の
 * グループ集約テスト）だけ `entryGroupId` を明示で上書きする。
 */
function makeItem(overrides: Partial<EntryBoardItem> = {}): EntryBoardItem {
  const id = overrides.id ?? 1
  const title = overrides.title ?? '大会'
  return {
    id,
    entryGroupId: id,
    // page.tsx が計算して転記する値の既定 = シングルトン（自分自身が代表）。
    // 複数日を同じグループにまとめるテストは、実際に page.tsx が計算する
    // であろう値（全メンバー共通）を明示で上書きする。
    groupName: title,
    groupDisplayName: title,
    groupRepresentativeEventId: id,
    title,
    shortName: null,
    eventDate: '2026-08-01',
    eligibleGrades: null,
    internalDeadline: null,
    entryDeadline: null,
    paymentDeadline: null,
    lotteryDate: null,
    entryStatus: 'not_applied',
    paymentType: null,
    paymentStatus: 'unpaid',
    attendCount: 0,
    hasConfirmedRoster: false,
    ...overrides,
  }
}

const areaDef = (id: AreaId) => AREAS.find((a) => a.id === id)!

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// classify（AC-5〜AC-14）
// ---------------------------------------------------------------------------

describe('classify', () => {
  it('not_applying → 非表示（no_applicants）', () => {
    const item = makeItem({ entryStatus: 'not_applying' })
    expect(classify(item, TODAY)).toBe('no_applicants')
  })

  it('not_applied かつ baseDeadline が両方 NULL → 締切前（AC-7）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: null,
      entryDeadline: null,
    })
    expect(classify(item, TODAY)).toBe('before_deadline')
  })

  it('not_applied かつ baseDeadline >= 今日 → 締切前（AC-6）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: '2026-07-15',
    })
    expect(classify(item, TODAY)).toBe('before_deadline')
  })

  it('baseDeadline === todayStr → 締切前にとどまる（AC-8 境界）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: TODAY,
    })
    expect(classify(item, TODAY)).toBe('before_deadline')
  })

  it('baseDeadline が今日より前の日（翌日）→ 参加者ありなら要申込（AC-8 境界）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: '2026-07-09',
      attendCount: 1,
    })
    expect(classify(item, TODAY)).toBe('action_required')
  })

  it('baseDeadline が今日より前で参加者0名 → 非表示（AC-8 境界 / AC-5）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: '2026-07-09',
      attendCount: 0,
    })
    expect(classify(item, TODAY)).toBe('no_applicants')
  })

  it('not_applied かつ baseDeadline < 今日 かつ 参加者1名以上 → 要申込（AC-9）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: '2026-06-01',
      attendCount: 3,
    })
    expect(classify(item, TODAY)).toBe('action_required')
  })

  it('not_applied かつ baseDeadline < 今日 かつ 参加者0名 → 非表示（AC-5）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: '2026-06-01',
      attendCount: 0,
    })
    expect(classify(item, TODAY)).toBe('no_applicants')
  })

  it('entryDeadline のみ非 NULL（internalDeadline 未入力）でも締切超過判定に使われる（baseDeadlineOf フォールバック経由）', () => {
    const item = makeItem({
      entryStatus: 'not_applied',
      internalDeadline: null,
      entryDeadline: '2026-06-01',
      attendCount: 1,
    })
    expect(classify(item, TODAY)).toBe('action_required')
  })

  it('applied かつ advance かつ unpaid かつ確定名簿なし → 申込完了・抽選待ち（AC-10）', () => {
    // 2026-07-27 以降、「抽選待ち」は事前払い・未振込に限られる。
    // makeItem の既定は paymentType: null（＝支払い管理なし＝完了）なので、
    // この区画を狙うテストは支払い条件を明示する。
    const item = makeItem({
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      hasConfirmedRoster: false,
    })
    expect(classify(item, TODAY)).toBe('applied_waiting')
  })

  it('applied かつ advance かつ paid → 確定名簿が無くても完了（AC-12b・本改修の主目的）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'paid',
      hasConfirmedRoster: false,
    })
    expect(classify(item, TODAY)).toBe('done')
  })

  it('applied かつ onsite → 確定名簿が無くても完了（AC-12c）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      paymentType: 'onsite',
      paymentStatus: 'unpaid',
      hasConfirmedRoster: false,
    })
    expect(classify(item, TODAY)).toBe('done')
  })

  it('applied かつ paymentType が NULL → 確定名簿が無くても完了（AC-12c）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      paymentType: null,
      hasConfirmedRoster: false,
    })
    expect(classify(item, TODAY)).toBe('done')
  })

  it('applied かつ確定名簿あり かつ advance かつ unpaid → 名簿確定・要振込（AC-11）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      hasConfirmedRoster: true,
      paymentType: 'advance',
      paymentStatus: 'unpaid',
    })
    expect(classify(item, TODAY)).toBe('payment_due')
  })

  it('applied かつ確定名簿あり かつ advance かつ paid → 完了（AC-12）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      hasConfirmedRoster: true,
      paymentType: 'advance',
      paymentStatus: 'paid',
    })
    expect(classify(item, TODAY)).toBe('done')
  })

  it('applied かつ確定名簿あり かつ onsite → 完了（AC-12）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      hasConfirmedRoster: true,
      paymentType: 'onsite',
      paymentStatus: 'unpaid',
    })
    expect(classify(item, TODAY)).toBe('done')
  })

  it('applied かつ確定名簿あり かつ paymentType が NULL → 完了（AC-12）', () => {
    const item = makeItem({
      entryStatus: 'applied',
      hasConfirmedRoster: true,
      paymentType: null,
    })
    expect(classify(item, TODAY)).toBe('done')
  })

  // AC-13b: 確定名簿は「完了」の必須要件ではなくなったので、名簿の有無で結果が
  // 変わるのは事前払い・未振込の 1 ケースだけになった。対のケースで固定する。
  it('AC-13b: 確定名簿の有無が区画を左右するのは advance かつ unpaid のときだけ', () => {
    const withRoster = (overrides: Partial<EntryBoardItem>) =>
      classify(makeItem({ entryStatus: 'applied', hasConfirmedRoster: true, ...overrides }), TODAY)
    const withoutRoster = (overrides: Partial<EntryBoardItem>) =>
      classify(makeItem({ entryStatus: 'applied', hasConfirmedRoster: false, ...overrides }), TODAY)

    // 事前払い・未振込だけ結果が分かれる
    const advanceUnpaid = { paymentType: 'advance', paymentStatus: 'unpaid' } as const
    expect(withRoster(advanceUnpaid)).toBe('payment_due')
    expect(withoutRoster(advanceUnpaid)).toBe('applied_waiting')

    // それ以外は名簿の有無で変わらない（いずれも完了）
    for (const paid of [
      { paymentType: 'advance', paymentStatus: 'paid' } as const,
      { paymentType: 'onsite', paymentStatus: 'unpaid' } as const,
      { paymentType: 'onsite', paymentStatus: 'paid' } as const,
      { paymentType: null, paymentStatus: 'unpaid' } as const,
      { paymentType: null, paymentStatus: 'paid' } as const,
    ]) {
      expect(withRoster(paid)).toBe('done')
      expect(withoutRoster(paid)).toBe('done')
    }
  })
})

// ---------------------------------------------------------------------------
// AREAS（AC-35 改称 / AC-40 内部識別子の不変）
// ---------------------------------------------------------------------------

describe('AREAS', () => {
  it('AC-35: 区画名がライフサイクル順に新名称で並ぶ', () => {
    expect(AREAS.map((a) => a.label)).toEqual([
      '締切前',
      '要申込',
      '申込完了・抽選待ち',
      '名簿確定・要振込',
      '完了',
    ])
  })

  // ★このファイルで旧名の文字列リテラルが現れる唯一の場所（改称が効いている
  //   ことの検証そのものなので必要）。他の箇所に旧名が残っていたら改称漏れ。
  it('AC-35: 旧名がどの label にも残っていない', () => {
    const labels = AREAS.map((a) => a.label)
    expect(labels).not.toContain('要対応')
    expect(labels).not.toContain('申込済み・抽選待ち')
    expect(labels).not.toContain('名簿確定・振込待ち')
  })

  // 改称は AreaDef.label の文字列だけ。id を変えると entry-overdue-alert との
  // 対応関係と既存テストの参照が無駄に壊れる（要件 §3.2.3 の注記）。
  it('AC-40: AreaId（内部識別子）が変わっていない', () => {
    expect(AREAS.map((a) => a.id)).toEqual([
      'before_deadline',
      'action_required',
      'applied_waiting',
      'payment_due',
      'done',
    ])
  })

  // 改称は純粋な表示変更。日付の種類・行動フェーズ・残日数の出し分け・
  // 折りたたみの設定は 1 つも変えていない（AC-31c 回帰）。
  it('AC-31c: 区画の属性（日付の種類・行動フェーズ・残日数・折りたたみ）が不変', () => {
    expect(AREAS.map((a) => a.deadlineHint)).toEqual([
      '会内締切',
      '本締切',
      '抽選日',
      '支払締切',
      '開催日',
    ])
    expect(AREAS.map((a) => a.actionable)).toEqual([false, true, false, true, false])
    expect(AREAS.map((a) => a.showCountdown !== false)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ])
    expect(AREAS.filter((a) => a.collapsible === true).map((a) => a.id)).toEqual([
      'before_deadline',
    ])
    expect(AREAS.filter((a) => a.collapsedByDefault === true)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 相互排他の網羅テスト（AC-14。シングルトングループ = 従来の「1行=1大会」相当）
// ---------------------------------------------------------------------------

describe('groupBoard — 相互排他の網羅（AC-14, シングルトン）', () => {
  it('代表的な入力集合の各大会がちょうど1区画に入る（または非表示になる）', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, entryStatus: 'not_applying' }), // 非表示
      makeItem({ id: 2, entryStatus: 'not_applied', internalDeadline: null, entryDeadline: null }), // 締切前(NULL)
      makeItem({ id: 3, entryStatus: 'not_applied', internalDeadline: TODAY }), // 締切前(当日)
      makeItem({
        id: 4,
        entryStatus: 'not_applied',
        internalDeadline: '2026-06-01',
        attendCount: 0,
      }), // 非表示(超過・0名)
      makeItem({
        id: 5,
        entryStatus: 'not_applied',
        internalDeadline: '2026-06-01',
        attendCount: 1,
      }), // 要申込
      makeItem({
        id: 6,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        hasConfirmedRoster: false,
      }), // 抽選待ち
      makeItem({
        id: 7,
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      }), // 振込待ち
      makeItem({
        id: 8,
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'advance',
        paymentStatus: 'paid',
      }), // 完了(振込済)
      makeItem({
        id: 9,
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'onsite',
      }), // 完了(現地払い)
      makeItem({
        id: 10,
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: null,
      }), // 完了(支払い管理なし)
      // 2026-07-27 の改修で完了へ移った 3 ケース（いずれも確定名簿なし）。
      makeItem({
        id: 11,
        entryStatus: 'applied',
        hasConfirmedRoster: false,
        paymentType: 'advance',
        paymentStatus: 'paid',
      }), // 完了(振込済・名簿なし)
      makeItem({
        id: 12,
        entryStatus: 'applied',
        hasConfirmedRoster: false,
        paymentType: 'onsite',
      }), // 完了(現地払い・名簿なし)
      makeItem({
        id: 13,
        entryStatus: 'applied',
        hasConfirmedRoster: false,
        paymentType: null,
      }), // 完了(支払い管理なし・名簿なし)
    ]

    const board = groupBoard(items, TODAY)
    // 各 makeItem は既定で entryGroupId = id（シングルトン）なので、
    // 1グループ = 1カード = 1日別行になる。カードの日別行 id を平らにすれば
    // 従来の「1行=1大会」の網羅結果とそのまま比較できる。
    const allIds = AREAS.flatMap((a) => board[a.id])
      .flatMap((g) => g.days.map((d) => d.id))

    // 非表示(1, 4)を除く全件がちょうど1回ずつ現れる = 重複も欠落もない
    const expectedVisible = [2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    expect(allIds.sort((a, b) => a - b)).toEqual(expectedVisible)
    expect(new Set(allIds).size).toBe(allIds.length) // 重複なし

    const byId = (a: number, b: number) => a - b
    const idsOf = (area: VisibleAreaId) =>
      board[area].flatMap((g) => g.days.map((d) => d.id)).sort(byId)
    expect(idsOf('before_deadline')).toEqual([2, 3])
    expect(idsOf('action_required')).toEqual([5])
    expect(idsOf('applied_waiting')).toEqual([6])
    expect(idsOf('payment_due')).toEqual([7])
    expect(idsOf('done')).toEqual([8, 9, 10, 11, 12, 13])
    // 非表示(1, 4)はどの区画にも現れない（GroupedBoard は描画する区画しか持たない）
    expect(allIds).not.toContain(1)
    expect(allIds).not.toContain(4)

    // シングルトンの代表イベントは自分自身、グループ名は自分のタイトル
    // （設計判断6: 「従来同等の見え方」の担保）。
    for (const area of AREAS) {
      for (const group of board[area.id]) {
        expect(group.days).toHaveLength(1)
        expect(group.representativeEventId).toBe(group.days[0]!.id)
        expect(group.name).toBe(group.days[0]!.title)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// グループ集約規則（タスク6, AC-14/AC-15）
// ---------------------------------------------------------------------------

describe('groupBoard — グループ集約規則', () => {
  it('全日が非表示（no_applicants）ならグループごと非表示になる', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, entryGroupId: 100, entryStatus: 'not_applying', eventDate: '2026-08-01' }),
      makeItem({ id: 2, entryGroupId: 100, entryStatus: 'not_applying', eventDate: '2026-08-02' }),
    ]
    const board = groupBoard(items, TODAY)
    const allGroups = AREAS.flatMap((a) => board[a.id])
    expect(allGroups).toHaveLength(0)
  })

  it('一部の日だけ非表示（no_applicants）なら、集約の母集団は残りの可視日だけになる', () => {
    // 多摩C=申込済み・多摩D,E=申し込まない、を模したケース。
    // ★表示名は**グループの全イベント**から page.tsx が導出する（設計判断4）ので、
    //   非表示日を含む「多摩CDE」のまま。一方、人数・日付の集約母集団は可視日だけ
    //   （AC-38）。この 2 つが違う母集団を見るのは意図的な設計。
    const items: EntryBoardItem[] = [
      makeItem({
        id: 1,
        entryGroupId: 200,
        title: '多摩C',
        groupDisplayName: '多摩CDE',
        eventDate: '2026-08-01',
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        hasConfirmedRoster: false,
        attendCount: 2,
      }),
      makeItem({
        id: 2,
        entryGroupId: 200,
        title: '多摩D',
        groupDisplayName: '多摩CDE',
        eventDate: '2026-08-02',
        entryStatus: 'not_applying',
        attendCount: 5,
      }),
      makeItem({
        id: 3,
        entryGroupId: 200,
        title: '多摩E',
        groupDisplayName: '多摩CDE',
        eventDate: '2026-08-03',
        entryStatus: 'not_applying',
        attendCount: 7,
      }),
    ]
    const board = groupBoard(items, TODAY)
    expect(board.applied_waiting).toHaveLength(1)
    const group = board.applied_waiting[0]!
    expect(group.days.map((d) => d.id)).toEqual([1])
    expect(group.name).toBe('多摩CDE')
    // AC-38: 非表示日（D=5名・E=7名）の人数は合計に含まれない
    expect(groupAttendCount(group)).toBe(2)
    // 非表示の D・E はどの区画にも現れない
    expect(AREAS.flatMap((a) => board[a.id]).flatMap((g) => g.days.map((d) => d.id))).toEqual([1])
  })

  it('日別 classify が食い違うとき、「最も対応が必要な区画」に寄せる（優先順位: action_required > payment_due > applied_waiting > before_deadline > done）', () => {
    const items: EntryBoardItem[] = [
      makeItem({
        id: 1,
        entryGroupId: 300,
        eventDate: '2026-08-01',
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'onsite',
      }), // done
      makeItem({
        id: 2,
        entryGroupId: 300,
        eventDate: '2026-08-02',
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      }), // payment_due
      makeItem({
        id: 3,
        entryGroupId: 300,
        eventDate: '2026-08-03',
        entryStatus: 'not_applied',
        internalDeadline: '2026-06-01',
        attendCount: 1,
      }), // action_required
    ]
    const board = groupBoard(items, TODAY)
    // action_required が最優先。他の区画にはこのグループは現れない。
    expect(board.action_required).toHaveLength(1)
    expect(board.payment_due).toHaveLength(0)
    expect(board.done).toHaveLength(0)
    const group = board.action_required[0]!
    // 日別行は非表示以外の全3日を、開催日昇順で保持する
    expect(group.days.map((d) => d.id)).toEqual([1, 2, 3])
  })

  it('applied_waiting と before_deadline が食い違う場合は applied_waiting を優先する', () => {
    const items: EntryBoardItem[] = [
      makeItem({
        id: 1,
        entryGroupId: 301,
        eventDate: '2026-08-01',
        entryStatus: 'not_applied',
        internalDeadline: '2026-07-20',
      }), // before_deadline
      makeItem({
        id: 2,
        entryGroupId: 301,
        eventDate: '2026-08-02',
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        hasConfirmedRoster: false,
      }), // applied_waiting
    ]
    const board = groupBoard(items, TODAY)
    expect(board.applied_waiting).toHaveLength(1)
    expect(board.before_deadline).toHaveLength(0)
  })

  // 2026-07-27 の改修で初めて生じる組み合わせ。`hasConfirmedRoster` はグループ
  // 単位（確定名簿は entry_group に紐づく）だが `paymentStatus` はイベント単位
  // なので、同じグループの中で「振込済の日」と「事前払い・未振込の日」が並びうる。
  it('名簿なしのまま片方だけ振込済のグループは、applied_waiting に1行だけ載る', () => {
    const items: EntryBoardItem[] = [
      makeItem({
        id: 1,
        entryGroupId: 302,
        eventDate: '2026-08-01',
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'paid',
        hasConfirmedRoster: false,
      }), // done（名簿なしでも支払い決着済み）
      makeItem({
        id: 2,
        entryGroupId: 302,
        eventDate: '2026-08-02',
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        hasConfirmedRoster: false,
      }), // applied_waiting
    ]
    const board = groupBoard(items, TODAY)
    // GROUP_AREA_PRIORITY: applied_waiting > done
    expect(board.applied_waiting).toHaveLength(1)
    expect(board.done).toHaveLength(0)
    expect(board.applied_waiting[0]!.days.map((d) => d.id)).toEqual([1, 2])
  })

  // name / representativeEventId の**計算**（deriveEntryGroupName・
  // selectRepresentativeEvent）は `@/lib/entry-groups` の責務であり、
  // page.tsx が一度だけ呼んで結果を EntryBoardItem.groupDisplayName /
  // groupRepresentativeEventId として転記する（entry-board-utils.ts はこの
  // ファイルから lib を import しない——client バンドル汚染を避けるため。
  // ファイル冒頭の import コメント参照）。ここでは「groupBoard は
  // メンバーが持つ値をそのまま転記するだけで、自前で再計算しない」ことだけを
  // 固定する。実際の計算結果が正しく渡ることは page.test.tsx の DB 統合テストで
  // 確認する。
  it('name は groupDisplayName（通称ベース）を転記する。title 由来の groupName は読まない', () => {
    const items: EntryBoardItem[] = [
      makeItem({
        id: 1,
        entryGroupId: 400,
        title: '第30回多摩大会A級',
        eventDate: '2026-08-01',
        groupName: '第30回多摩大会',
        groupDisplayName: '多摩AB',
        groupRepresentativeEventId: 1,
      }),
      makeItem({
        id: 2,
        entryGroupId: 400,
        title: '第30回多摩大会B級',
        eventDate: '2026-08-02',
        groupName: '第30回多摩大会',
        groupDisplayName: '多摩AB',
        groupRepresentativeEventId: 1,
      }),
    ]
    const board = groupBoard(items, TODAY)
    const group = board.before_deadline[0]!
    expect(group.name).toBe('多摩AB')
    expect(group.representativeEventId).toBe(1)
  })

  // 設計判断4: 代表イベント・グループ名は「グループというまとまり」のプロパティ
  // であって「ボードに見えている行」のプロパティではない、という意図的な選択。
  // page.tsx はグループの**全メンバー**（可視・非表示を問わない）から一度だけ
  // 計算するので、今日以降で最も近い日が「申し込まない」で非表示になっていても、
  // カードの遷移先はその非表示日を指しうる。
  it('代表イベントが非表示（no_applicants）の日でも、行の遷移先はそのまま（グループのプロパティなので board 表示可否と独立）', () => {
    const items: EntryBoardItem[] = [
      // 今日以降で最も近いが、申し込まない（非表示）→ それでも代表になりうる
      makeItem({
        id: 1,
        entryGroupId: 401,
        title: '多摩C',
        eventDate: '2026-07-15',
        entryStatus: 'not_applying',
        groupName: '多摩CD',
        groupDisplayName: '多摩CD',
        groupRepresentativeEventId: 1,
      }),
      makeItem({
        id: 2,
        entryGroupId: 401,
        title: '多摩D',
        eventDate: '2026-08-01',
        groupName: '多摩CD',
        groupDisplayName: '多摩CD',
        groupRepresentativeEventId: 1,
      }),
    ]
    const board = groupBoard(items, TODAY)
    const group = board.before_deadline[0]!
    // 集約母集団の可視日は id2 だけ（id1 は non_applicants で非表示）
    expect(group.days.map((d) => d.id)).toEqual([2])
    // だが行の遷移先・表示名はグループ全体から計算された値のまま
    expect(group.representativeEventId).toBe(1)
    expect(group.name).toBe('多摩CD')
  })
})

// ---------------------------------------------------------------------------
// カードの並び順（タスク6）
// ---------------------------------------------------------------------------

describe('groupBoard — カードの並び順', () => {
  it('区画内はグループの中で最も早い日（区画の観点で見た締切）が並び順キー。全日 NULL は末尾', () => {
    const items: EntryBoardItem[] = [
      // グループ 800: 最も早い entryDeadline は 7/25
      makeItem({
        id: 1,
        entryGroupId: 800,
        internalDeadline: '2026-06-01',
        entryDeadline: '2026-08-01',
        attendCount: 1,
      }),
      makeItem({
        id: 2,
        entryGroupId: 800,
        internalDeadline: '2026-06-01',
        entryDeadline: '2026-07-25',
        attendCount: 1,
      }),
      // グループ 801: entryDeadline は 7/15（800 より早い→先に並ぶ）
      makeItem({
        id: 3,
        entryGroupId: 801,
        internalDeadline: '2026-06-01',
        entryDeadline: '2026-07-15',
        attendCount: 1,
      }),
      // グループ 802: 全日 entryDeadline が NULL → 末尾
      makeItem({
        id: 4,
        entryGroupId: 802,
        internalDeadline: '2026-06-01',
        entryDeadline: null,
        attendCount: 1,
      }),
    ]
    const board = groupBoard(items, TODAY)
    expect(board.action_required.map((g) => g.groupId)).toEqual([801, 800, 802])
  })

  // AC-15 / AC-31c 回帰: 並び順キーが同値のときの副キーは「可視日の中で最も早い
  // **開催日**」であって、代表日（＝最も早い締切の日）の開催日ではない。
  // groupSortKey を pickRepresentativeDay 経由に統一したときに、副キーまで
  // 代表日へ寄せると静かに壊れる箇所。
  it('並び順キーが同値なら、可視日の最小開催日が副キーになる（代表日の開催日ではない）', () => {
    const mk = (id: number, groupId: number, eventDate: string, paymentDeadline: string) =>
      makeItem({
        id,
        entryGroupId: groupId,
        eventDate,
        paymentDeadline,
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
    const items: EntryBoardItem[] = [
      // グループ 810: 最小支払締切 7/20（開催日 9/1 の日）／最小開催日は 8/20
      mk(1, 810, '2026-09-01', '2026-07-20'),
      mk(2, 810, '2026-08-20', '2026-08-30'),
      // グループ 811: 最小支払締切 7/20（同値）／最小開催日は 8/10 → 先に並ぶ
      mk(3, 811, '2026-09-02', '2026-07-20'),
      mk(4, 811, '2026-08-10', '2026-08-31'),
    ]
    const board = groupBoard(items, TODAY)
    expect(board.payment_due.map((g) => g.groupId)).toEqual([811, 810])
  })
})

// ---------------------------------------------------------------------------
// グループの集約規則（要件 §3.2.5.1 / AC-37, AC-38）
// ---------------------------------------------------------------------------

/** 1グループぶんの items から、その区画に載ったグループを取り出すヘルパー。 */
function soleGroup(items: EntryBoardItem[], area: VisibleAreaId) {
  const board = groupBoard(items, TODAY)
  expect(board[area]).toHaveLength(1)
  return board[area][0]!
}

describe('pickRepresentativeDay', () => {
  it('その区画で見る日付が最も早い可視日を選ぶ', () => {
    const group = soleGroup(
      [
        makeItem({ id: 1, entryGroupId: 700, entryDeadline: '2026-08-01', attendCount: 1 }),
        makeItem({ id: 2, entryGroupId: 700, entryDeadline: '2026-07-25', attendCount: 1 }),
        makeItem({ id: 3, entryGroupId: 700, entryDeadline: '2026-09-01', attendCount: 1 }),
      ].map((i) => ({ ...i, internalDeadline: '2026-06-01' })),
      'action_required',
    )
    expect(pickRepresentativeDay(group, TODAY).id).toBe(2)
  })

  it('NULL は末尾扱い（非 NULL の日が優先される）', () => {
    const group = soleGroup(
      [
        makeItem({
          id: 1,
          entryGroupId: 701,
          internalDeadline: '2026-06-01',
          entryDeadline: null,
          attendCount: 1,
        }),
        makeItem({
          id: 2,
          entryGroupId: 701,
          internalDeadline: '2026-06-01',
          entryDeadline: '2026-09-01',
          attendCount: 1,
        }),
      ],
      'action_required',
    )
    expect(pickRepresentativeDay(group, TODAY).id).toBe(2)
  })

  it('全日 NULL なら安定した1件（開催日 → id）を返す', () => {
    const items = [
      makeItem({
        id: 9,
        entryGroupId: 702,
        eventDate: '2026-09-01',
        internalDeadline: '2026-06-01',
        entryDeadline: null,
        attendCount: 1,
      }),
      makeItem({
        id: 5,
        entryGroupId: 702,
        eventDate: '2026-08-01',
        internalDeadline: '2026-06-01',
        entryDeadline: null,
        attendCount: 1,
      }),
    ]
    expect(pickRepresentativeDay(soleGroup(items, 'action_required'), TODAY).id).toBe(5)
    // 入力順を変えても同じ日を選ぶ（安定）
    expect(
      pickRepresentativeDay(soleGroup(items.slice().reverse(), 'action_required'), TODAY).id,
    ).toBe(5)
  })

  it('キーも開催日も同値なら id の小さい方（決定的）', () => {
    const group = soleGroup(
      [
        makeItem({
          id: 8,
          entryGroupId: 703,
          eventDate: '2026-08-01',
          internalDeadline: '2026-06-01',
          entryDeadline: '2026-07-25',
          attendCount: 1,
        }),
        makeItem({
          id: 3,
          entryGroupId: 703,
          eventDate: '2026-08-01',
          internalDeadline: '2026-06-01',
          entryDeadline: '2026-07-25',
          attendCount: 1,
        }),
      ],
      'action_required',
    )
    expect(pickRepresentativeDay(group, TODAY).id).toBe(3)
  })
})

describe('groupDeadlineBadge（AC-37）', () => {
  // 並び順キーと画面に出る日付が構造的に同じ日から出ることの担保。
  // グループ内で締切が食い違うケースで検証する。
  it('並び順キーと同じ日（＝最も早い日）のバッジを返す', () => {
    const group = soleGroup(
      [
        makeItem({
          id: 1,
          entryGroupId: 704,
          eventDate: '2026-08-01',
          entryStatus: 'applied',
          hasConfirmedRoster: true,
          paymentType: 'advance',
          paymentStatus: 'unpaid',
          paymentDeadline: '2026-07-20',
        }),
        makeItem({
          id: 2,
          entryGroupId: 704,
          eventDate: '2026-08-02',
          entryStatus: 'applied',
          hasConfirmedRoster: true,
          paymentType: 'advance',
          paymentStatus: 'unpaid',
          paymentDeadline: '2026-07-12',
        }),
      ],
      'payment_due',
    )
    const badge = groupDeadlineBadge(group, TODAY)
    expect(badge.label).toBe('支払締切')
    // 7/12（最も早い日）。7/20 ではない
    expect(badge.date).toBe('7/12')
    expect(badge.countdown).toBe('あと2日')
    expect(pickRepresentativeDay(group, TODAY).id).toBe(2)
  })

  it('全日 NULL ならその区画の NULL 表記になる（抽選日は「未定」）', () => {
    const group = soleGroup(
      [
        makeItem({
          id: 1,
          entryGroupId: 705,
          eventDate: '2026-08-01',
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'unpaid',
          lotteryDate: null,
        }),
        makeItem({
          id: 2,
          entryGroupId: 705,
          eventDate: '2026-08-02',
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'unpaid',
          lotteryDate: null,
        }),
      ],
      'applied_waiting',
    )
    const badge = groupDeadlineBadge(group, TODAY)
    expect(badge.date).toBeNull()
    expect(badge.countdown).toBe('未定')
    expect(badge.tone).toBe('none')
  })

  it('シングルトングループはその日自身のバッジと一致する（既存の見え方の回帰）', () => {
    const group = soleGroup(
      [makeItem({ id: 1, internalDeadline: '2026-07-12' })],
      'before_deadline',
    )
    expect(groupDeadlineBadge(group, TODAY)).toEqual(
      deadlineBadgeOf(group.days[0]!, 'before_deadline', TODAY),
    )
  })
})

describe('groupAttendCount（AC-38）', () => {
  it('可視日の合計になる', () => {
    const group = soleGroup(
      [
        makeItem({ id: 1, entryGroupId: 706, eventDate: '2026-08-01', attendCount: 0 }),
        makeItem({ id: 2, entryGroupId: 706, eventDate: '2026-08-02', attendCount: 1 }),
        makeItem({ id: 3, entryGroupId: 706, eventDate: '2026-08-03', attendCount: 4 }),
      ],
      'before_deadline',
    )
    expect(groupAttendCount(group)).toBe(5)
  })

  it('シングルトングループはその日の人数そのまま', () => {
    const group = soleGroup([makeItem({ id: 1, attendCount: 3 })], 'before_deadline')
    expect(groupAttendCount(group)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// sortArea（AC-15）
// ---------------------------------------------------------------------------

describe('sortArea', () => {
  it('締切前：会内締切（baseDeadline）昇順・NULL 末尾・開催日を副キー', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, internalDeadline: '2026-07-20', eventDate: '2026-08-10' }),
      makeItem({ id: 2, internalDeadline: null, eventDate: '2026-08-05' }),
      makeItem({ id: 3, internalDeadline: '2026-07-15', eventDate: '2026-08-01' }),
      makeItem({ id: 4, internalDeadline: null, eventDate: '2026-08-01' }),
    ]
    const sorted = sortArea(items, 'before_deadline', TODAY).map((i) => i.id)
    expect(sorted).toEqual([3, 1, 4, 2]) // NULL同士(4,2)は開催日 8/1 < 8/5 で 4 が先
  })

  it('要申込：本締切（entryDeadline）昇順・NULL 末尾（internalDeadline は無視）', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, internalDeadline: '2026-01-01', entryDeadline: '2026-07-20' }),
      makeItem({ id: 2, internalDeadline: '2026-12-01', entryDeadline: null }),
      makeItem({ id: 3, internalDeadline: '2026-12-31', entryDeadline: '2026-07-15' }),
    ]
    const sorted = sortArea(items, 'action_required', TODAY).map((i) => i.id)
    expect(sorted).toEqual([3, 1, 2])
  })

  it('申込完了・抽選待ち：抽選日（lotteryDate）昇順・NULL 末尾', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, lotteryDate: '2026-07-20' }),
      makeItem({ id: 2, lotteryDate: null }),
      makeItem({ id: 3, lotteryDate: '2026-07-15' }),
    ]
    const sorted = sortArea(items, 'applied_waiting', TODAY).map((i) => i.id)
    expect(sorted).toEqual([3, 1, 2])
  })

  it('名簿確定・要振込：支払締切（paymentDeadline）昇順・NULL 末尾', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, paymentDeadline: '2026-07-20' }),
      makeItem({ id: 2, paymentDeadline: null }),
      makeItem({ id: 3, paymentDeadline: '2026-07-15' }),
    ]
    const sorted = sortArea(items, 'payment_due', TODAY).map((i) => i.id)
    expect(sorted).toEqual([3, 1, 2])
  })

  it('完了：開催日（eventDate）昇順', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, eventDate: '2026-08-10' }),
      makeItem({ id: 2, eventDate: '2026-08-01' }),
      makeItem({ id: 3, eventDate: '2026-08-05' }),
    ]
    const sorted = sortArea(items, 'done', TODAY).map((i) => i.id)
    expect(sorted).toEqual([2, 3, 1])
  })

  it('入力配列を破壊しない（非破壊ソート）', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, eventDate: '2026-08-10' }),
      makeItem({ id: 2, eventDate: '2026-08-01' }),
    ]
    const before = items.map((i) => i.id)
    sortArea(items, 'done', TODAY)
    expect(items.map((i) => i.id)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// deadlineBadgeOf（AC-18〜AC-20）
// ---------------------------------------------------------------------------

describe('deadlineBadgeOf', () => {
  it('締切前：会内締切（baseDeadlineOf）を見る', () => {
    const item = makeItem({ internalDeadline: '2026-07-14' })
    const badge = deadlineBadgeOf(item, 'before_deadline', TODAY)
    expect(badge.label).toBe('会内締切')
    expect(badge.date).toBe('7/14')
  })

  it('要申込：entryDeadline を見る（internalDeadline ではない）', () => {
    const item = makeItem({
      internalDeadline: '2026-01-01',
      entryDeadline: '2026-07-20',
    })
    const badge = deadlineBadgeOf(item, 'action_required', TODAY)
    expect(badge.label).toBe('本締切')
    expect(badge.date).toBe('7/20')
  })

  it('申込完了・抽選待ち：lotteryDate を見て NULL は「未定」', () => {
    const withDate = deadlineBadgeOf(
      makeItem({ lotteryDate: '2026-07-20' }),
      'applied_waiting',
      TODAY,
    )
    expect(withDate.label).toBe('抽選日')
    expect(withDate.date).toBe('7/20')

    const withoutDate = deadlineBadgeOf(makeItem({ lotteryDate: null }), 'applied_waiting', TODAY)
    expect(withoutDate.date).toBeNull()
    expect(withoutDate.countdown).toBe('未定')
    expect(withoutDate.tone).toBe('none')
  })

  it('名簿確定・要振込：paymentDeadline を見る', () => {
    const badge = deadlineBadgeOf(
      makeItem({ paymentDeadline: '2026-07-20' }),
      'payment_due',
      TODAY,
    )
    expect(badge.label).toBe('支払締切')
    expect(badge.date).toBe('7/20')
  })

  it('完了：eventDate を見る', () => {
    const badge = deadlineBadgeOf(makeItem({ eventDate: '2026-08-20' }), 'done', TODAY)
    expect(badge.label).toBe('開催日')
    expect(badge.date).toBe('8/20')
  })

  it('締切系（会内締切・本締切・支払締切）の NULL は「締切未設定」', () => {
    expect(
      deadlineBadgeOf(
        makeItem({ internalDeadline: null, entryDeadline: null }),
        'action_required',
        TODAY,
      ).countdown,
    ).toBe('締切未設定')
  })
})

describe('残日数の表示条件（AC-18）', () => {
  it('締切超過 → N日超過 / past', () => {
    const badge = deadlineBadgeOf(makeItem({ internalDeadline: '2026-07-05' }), 'before_deadline', TODAY)
    expect(badge.countdown).toBe('5日超過')
    expect(badge.tone).toBe('past')
  })

  it('締切当日 → 本日 / today', () => {
    const badge = deadlineBadgeOf(makeItem({ internalDeadline: TODAY }), 'before_deadline', TODAY)
    expect(badge.countdown).toBe('本日')
    expect(badge.tone).toBe('today')
  })

  it('締切まで1日 → あと1日 / soon', () => {
    const badge = deadlineBadgeOf(
      makeItem({ internalDeadline: '2026-07-11' }),
      'before_deadline',
      TODAY,
    )
    expect(badge.countdown).toBe('あと1日')
    expect(badge.tone).toBe('soon')
  })

  it('締切まで3日（境界） → あと3日 / soon', () => {
    const badge = deadlineBadgeOf(
      makeItem({ internalDeadline: '2026-07-13' }),
      'before_deadline',
      TODAY,
    )
    expect(badge.countdown).toBe('あと3日')
    expect(badge.tone).toBe('soon')
  })

  it('締切まで4日（境界） → tone は normal（描画側で落とす）', () => {
    const badge = deadlineBadgeOf(
      makeItem({ internalDeadline: '2026-07-14' }),
      'before_deadline',
      TODAY,
    )
    expect(badge.countdown).toBe('あと4日')
    expect(badge.tone).toBe('normal')
  })

  it('日付未設定 → tone は none', () => {
    const badge = deadlineBadgeOf(
      makeItem({ internalDeadline: null, entryDeadline: null }),
      'before_deadline',
      TODAY,
    )
    expect(badge.tone).toBe('none')
  })
})

describe('AC-19: 申込完了・抽選待ち と 完了 の残日数は常に出さない前提（描画側条件の元データ）', () => {
  it('抽選待ちは lotteryDate が近くても badge 自体は出るが、showCountdown=false で描画抑止される', () => {
    // entry-board-utils はデータだけを返す。表示抑止は AreaDef.showCountdown を
    // 描画側が見て行う（このテストは showCountdown フラグの値を固定する）。
    expect(areaDef('applied_waiting').showCountdown).toBe(false)
    expect(areaDef('done').showCountdown).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isDue / isAreaHot（AC-21, AC-21b, AC-22）
// ---------------------------------------------------------------------------

describe('isDue', () => {
  it('締切当日 → true', () => {
    const item = makeItem({ entryDeadline: TODAY })
    expect(isDue(item, 'action_required', TODAY)).toBe(true)
  })

  it('締切超過 → true', () => {
    const item = makeItem({ entryDeadline: '2026-07-01' })
    expect(isDue(item, 'action_required', TODAY)).toBe(true)
  })

  it('締切 NULL → true（fail-safe, AC-21b）', () => {
    const item = makeItem({ entryDeadline: null })
    expect(isDue(item, 'action_required', TODAY)).toBe(true)
  })

  it('締切まで1〜3日 → false（到来していない）', () => {
    const item = makeItem({ entryDeadline: '2026-07-13' })
    expect(isDue(item, 'action_required', TODAY)).toBe(false)
  })

  it('締切まで4日以上先 → false', () => {
    const item = makeItem({ entryDeadline: '2026-07-14' })
    expect(isDue(item, 'action_required', TODAY)).toBe(false)
  })

  it('名簿確定・要振込でも同様に判定できる（paymentDeadline）', () => {
    expect(isDue(makeItem({ paymentDeadline: null }), 'payment_due', TODAY)).toBe(true)
    expect(isDue(makeItem({ paymentDeadline: '2026-07-20' }), 'payment_due', TODAY)).toBe(false)
  })
})

describe('isAreaHot', () => {
  it('要申込：締切到来済みが1件以上あれば true（AC-21）', () => {
    const items = [
      makeItem({ id: 1, entryDeadline: '2026-07-20' }), // 未到来
      makeItem({ id: 2, entryDeadline: '2026-07-01' }), // 超過
    ]
    expect(isAreaHot(areaDef('action_required'), items, TODAY)).toBe(true)
  })

  it('要申込：entry_deadline が NULL の大会が1件でもあれば true（AC-21b, fail-safe）', () => {
    const items = [makeItem({ id: 1, entryDeadline: null })]
    expect(isAreaHot(areaDef('action_required'), items, TODAY)).toBe(true)
  })

  it('要申込：全件が未到来（4日以上先）なら false（AC-21）', () => {
    const items = [
      makeItem({ id: 1, entryDeadline: '2026-07-20' }),
      makeItem({ id: 2, entryDeadline: '2026-08-01' }),
    ]
    expect(isAreaHot(areaDef('action_required'), items, TODAY)).toBe(false)
  })

  it('名簿確定・要振込：到来済みが1件以上あれば true（AC-21）', () => {
    const items = [makeItem({ id: 1, paymentDeadline: '2026-07-01' })]
    expect(isAreaHot(areaDef('payment_due'), items, TODAY)).toBe(true)
  })

  it('非行動フェーズ（締切前）は到来済みの行があっても常に false（AC-22）', () => {
    const items = [makeItem({ id: 1, internalDeadline: '2026-07-01' })]
    expect(isAreaHot(areaDef('before_deadline'), items, TODAY)).toBe(false)
  })

  it('非行動フェーズ（申込完了・抽選待ち）は常に false（AC-22）', () => {
    const items = [makeItem({ id: 1, lotteryDate: null })]
    expect(isAreaHot(areaDef('applied_waiting'), items, TODAY)).toBe(false)
  })

  it('非行動フェーズ（完了）は常に false（AC-22）', () => {
    const items = [makeItem({ id: 1, eventDate: '2026-07-01' })]
    expect(isAreaHot(areaDef('done'), items, TODAY)).toBe(false)
  })

  it('要申込：対象0件なら false', () => {
    expect(isAreaHot(areaDef('action_required'), [], TODAY)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isPinnedWhenCollapsed（AC-24）
// ---------------------------------------------------------------------------

describe('isPinnedWhenCollapsed', () => {
  it('締切前：会内締切が3日以内（境界）なら true', () => {
    const item = makeItem({ internalDeadline: '2026-07-13' })
    expect(isPinnedWhenCollapsed(item, 'before_deadline', TODAY)).toBe(true)
  })

  it('締切前：会内締切が当日なら true', () => {
    const item = makeItem({ internalDeadline: TODAY })
    expect(isPinnedWhenCollapsed(item, 'before_deadline', TODAY)).toBe(true)
  })

  it('締切前：会内締切が4日以上先（境界）なら false', () => {
    const item = makeItem({ internalDeadline: '2026-07-14' })
    expect(isPinnedWhenCollapsed(item, 'before_deadline', TODAY)).toBe(false)
  })

  it('締切未設定は false（判定不能＝畳めば隠れる）', () => {
    const item = makeItem({ internalDeadline: null, entryDeadline: null })
    expect(isPinnedWhenCollapsed(item, 'before_deadline', TODAY)).toBe(false)
  })

  it('締切前以外の区画は常に false（会内締切が近くても）', () => {
    const item = makeItem({ internalDeadline: TODAY })
    expect(isPinnedWhenCollapsed(item, 'action_required', TODAY)).toBe(false)
    expect(isPinnedWhenCollapsed(item, 'applied_waiting', TODAY)).toBe(false)
    expect(isPinnedWhenCollapsed(item, 'payment_due', TODAY)).toBe(false)
    expect(isPinnedWhenCollapsed(item, 'done', TODAY)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe('displayName', () => {
  it('通称 + 級（例: 札幌AB）', () => {
    const item = makeItem({ shortName: '札幌', eligibleGrades: ['A', 'B'] })
    expect(displayName(item)).toBe('札幌AB')
  })

  // Issue #335 回帰: title は運用上すでに級込み（「多摩A」等）なので、
  // フォールバック時に級を連結すると「多摩AA」と二重になる。title はそのまま出す。
  it('通称が NULL なら title にフォールバックし、級を追記しない（AC-1）', () => {
    const item = makeItem({ title: '多摩A', shortName: null, eligibleGrades: ['A'] })
    expect(displayName(item)).toBe('多摩A')
  })

  it('通称が NULL・複数級でも title のまま（AC-1: 鳳玉CDCD にならない）', () => {
    const item = makeItem({ title: '鳳玉CD', shortName: null, eligibleGrades: ['C', 'D'] })
    expect(displayName(item)).toBe('鳳玉CD')
  })

  it('級が NULL なら級なし', () => {
    const item = makeItem({ shortName: '札幌', eligibleGrades: null })
    expect(displayName(item)).toBe('札幌')
  })

  it('級が空配列でも級なし', () => {
    const item = makeItem({ shortName: '札幌', eligibleGrades: [] })
    expect(displayName(item)).toBe('札幌')
  })

  it('複数級は連結される（例: ABC）', () => {
    const item = makeItem({ shortName: '札幌', eligibleGrades: ['A', 'B', 'C'] })
    expect(displayName(item)).toBe('札幌ABC')
  })
})

// ---------------------------------------------------------------------------
// baseDeadlineOf
// ---------------------------------------------------------------------------

describe('baseDeadlineOf', () => {
  it('internalDeadline があればそれを使う', () => {
    const item = makeItem({ internalDeadline: '2026-07-15', entryDeadline: '2026-07-20' })
    expect(baseDeadlineOf(item)).toBe('2026-07-15')
  })

  it('internalDeadline が NULL なら entryDeadline で代替', () => {
    const item = makeItem({ internalDeadline: null, entryDeadline: '2026-07-20' })
    expect(baseDeadlineOf(item)).toBe('2026-07-20')
  })

  it('両方 NULL なら null', () => {
    const item = makeItem({ internalDeadline: null, entryDeadline: null })
    expect(baseDeadlineOf(item)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Date.now() を呼ばないこと（AC-27）
// ---------------------------------------------------------------------------

describe('Date.now() を呼ばない（AC-27）', () => {
  it('classify / sortArea / groupBoard / deadlineBadgeOf / isDue / isAreaHot / isPinnedWhenCollapsed が Date.now を呼ばない', () => {
    const nowSpy = vi.spyOn(Date, 'now')

    const items: EntryBoardItem[] = [
      makeItem({ id: 1, entryStatus: 'not_applied', internalDeadline: null }),
      makeItem({
        id: 2,
        entryStatus: 'applied',
        hasConfirmedRoster: true,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: '2026-07-01',
      }),
    ]

    const noDeadline = items[0]!
    const unpaid = items[1]!

    classify(noDeadline, TODAY)
    sortArea(items, 'before_deadline', TODAY)
    groupBoard(items, TODAY)
    deadlineBadgeOf(unpaid, 'payment_due', TODAY)
    isDue(unpaid, 'payment_due', TODAY)
    isAreaHot(areaDef('payment_due'), items, TODAY)
    isPinnedWhenCollapsed(noDeadline, 'before_deadline', TODAY)
    daysBetween(TODAY, '2026-07-20')

    expect(nowSpy).not.toHaveBeenCalled()
  })

  it('実際のシステム時刻をずらしても todayStr が同じなら結果が変わらない', () => {
    const item = makeItem({ internalDeadline: '2026-06-01', attendCount: 1 })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
    const areaWithFakeClock = classify(item, TODAY)
    const badgeWithFakeClock = deadlineBadgeOf(item, 'action_required', TODAY)
    vi.useRealTimers()

    const areaWithRealClock = classify(item, TODAY)
    const badgeWithRealClock = deadlineBadgeOf(item, 'action_required', TODAY)

    expect(areaWithFakeClock).toBe(areaWithRealClock)
    expect(badgeWithFakeClock).toEqual(badgeWithRealClock)
  })
})
