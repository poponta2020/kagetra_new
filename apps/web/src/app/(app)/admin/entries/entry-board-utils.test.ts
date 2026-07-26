import { describe, it, expect, vi, afterEach } from 'vitest'
import type { EntryBoardItem, AreaId } from './entry-board-utils'
import {
  AREAS,
  baseDeadlineOf,
  classify,
  daysBetween,
  deadlineBadgeOf,
  displayName,
  groupBoard,
  isAreaHot,
  isDue,
  isPinnedWhenCollapsed,
  sortArea,
} from './entry-board-utils'

const TODAY = '2026-07-10'

/** 未申込・締切前を既定値とする素の EntryBoardItem。 */
function makeItem(overrides: Partial<EntryBoardItem> = {}): EntryBoardItem {
  return {
    id: 1,
    title: '大会',
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

  it('baseDeadline が今日より前の日（翌日）→ 参加者ありなら要対応（AC-8 境界）', () => {
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

  it('not_applied かつ baseDeadline < 今日 かつ 参加者1名以上 → 要対応（AC-9）', () => {
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

  it('applied かつ確定名簿なし → 申込済み・抽選待ち（AC-10）', () => {
    const item = makeItem({ entryStatus: 'applied', hasConfirmedRoster: false })
    expect(classify(item, TODAY)).toBe('applied_waiting')
  })

  it('applied かつ確定名簿あり かつ advance かつ unpaid → 名簿確定・振込待ち（AC-11）', () => {
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
})

// ---------------------------------------------------------------------------
// 相互排他の網羅テスト（AC-14）
// ---------------------------------------------------------------------------

describe('groupBoard — 相互排他の網羅（AC-14）', () => {
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
      }), // 要対応
      makeItem({ id: 6, entryStatus: 'applied', hasConfirmedRoster: false }), // 抽選待ち
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
    ]

    const board = groupBoard(items, TODAY)
    const allIds = AREAS.flatMap((a) => board[a.id]).map((i) => i.id)

    // 非表示(1, 4)を除く全件がちょうど1回ずつ現れる = 重複も欠落もない
    const expectedVisible = [2, 3, 5, 6, 7, 8, 9, 10]
    expect(allIds.sort((a, b) => a - b)).toEqual(expectedVisible)
    expect(new Set(allIds).size).toBe(allIds.length) // 重複なし

    const byId = (a: number, b: number) => a - b
    expect(board.before_deadline.map((i) => i.id).sort(byId)).toEqual([2, 3])
    expect(board.action_required.map((i) => i.id)).toEqual([5])
    expect(board.applied_waiting.map((i) => i.id)).toEqual([6])
    expect(board.payment_due.map((i) => i.id)).toEqual([7])
    expect(board.done.map((i) => i.id).sort(byId)).toEqual([8, 9, 10])
    // 非表示(1, 4)はどの区画にも現れない（GroupedBoard は描画する区画しか持たない）
    expect(allIds).not.toContain(1)
    expect(allIds).not.toContain(4)
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

  it('要対応：本締切（entryDeadline）昇順・NULL 末尾（internalDeadline は無視）', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, internalDeadline: '2026-01-01', entryDeadline: '2026-07-20' }),
      makeItem({ id: 2, internalDeadline: '2026-12-01', entryDeadline: null }),
      makeItem({ id: 3, internalDeadline: '2026-12-31', entryDeadline: '2026-07-15' }),
    ]
    const sorted = sortArea(items, 'action_required', TODAY).map((i) => i.id)
    expect(sorted).toEqual([3, 1, 2])
  })

  it('申込済み・抽選待ち：抽選日（lotteryDate）昇順・NULL 末尾', () => {
    const items: EntryBoardItem[] = [
      makeItem({ id: 1, lotteryDate: '2026-07-20' }),
      makeItem({ id: 2, lotteryDate: null }),
      makeItem({ id: 3, lotteryDate: '2026-07-15' }),
    ]
    const sorted = sortArea(items, 'applied_waiting', TODAY).map((i) => i.id)
    expect(sorted).toEqual([3, 1, 2])
  })

  it('名簿確定・振込待ち：支払締切（paymentDeadline）昇順・NULL 末尾', () => {
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

  it('要対応：entryDeadline を見る（internalDeadline ではない）', () => {
    const item = makeItem({
      internalDeadline: '2026-01-01',
      entryDeadline: '2026-07-20',
    })
    const badge = deadlineBadgeOf(item, 'action_required', TODAY)
    expect(badge.label).toBe('本締切')
    expect(badge.date).toBe('7/20')
  })

  it('申込済み・抽選待ち：lotteryDate を見て NULL は「未定」', () => {
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

  it('名簿確定・振込待ち：paymentDeadline を見る', () => {
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

describe('AC-19: 申込済み・抽選待ち と 完了 の残日数は常に出さない前提（描画側条件の元データ）', () => {
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

  it('名簿確定・振込待ちでも同様に判定できる（paymentDeadline）', () => {
    expect(isDue(makeItem({ paymentDeadline: null }), 'payment_due', TODAY)).toBe(true)
    expect(isDue(makeItem({ paymentDeadline: '2026-07-20' }), 'payment_due', TODAY)).toBe(false)
  })
})

describe('isAreaHot', () => {
  it('要対応：締切到来済みが1件以上あれば true（AC-21）', () => {
    const items = [
      makeItem({ id: 1, entryDeadline: '2026-07-20' }), // 未到来
      makeItem({ id: 2, entryDeadline: '2026-07-01' }), // 超過
    ]
    expect(isAreaHot(areaDef('action_required'), items, TODAY)).toBe(true)
  })

  it('要対応：entry_deadline が NULL の大会が1件でもあれば true（AC-21b, fail-safe）', () => {
    const items = [makeItem({ id: 1, entryDeadline: null })]
    expect(isAreaHot(areaDef('action_required'), items, TODAY)).toBe(true)
  })

  it('要対応：全件が未到来（4日以上先）なら false（AC-21）', () => {
    const items = [
      makeItem({ id: 1, entryDeadline: '2026-07-20' }),
      makeItem({ id: 2, entryDeadline: '2026-08-01' }),
    ]
    expect(isAreaHot(areaDef('action_required'), items, TODAY)).toBe(false)
  })

  it('名簿確定・振込待ち：到来済みが1件以上あれば true（AC-21）', () => {
    const items = [makeItem({ id: 1, paymentDeadline: '2026-07-01' })]
    expect(isAreaHot(areaDef('payment_due'), items, TODAY)).toBe(true)
  })

  it('非行動フェーズ（締切前）は到来済みの行があっても常に false（AC-22）', () => {
    const items = [makeItem({ id: 1, internalDeadline: '2026-07-01' })]
    expect(isAreaHot(areaDef('before_deadline'), items, TODAY)).toBe(false)
  })

  it('非行動フェーズ（申込済み・抽選待ち）は常に false（AC-22）', () => {
    const items = [makeItem({ id: 1, lotteryDate: null })]
    expect(isAreaHot(areaDef('applied_waiting'), items, TODAY)).toBe(false)
  })

  it('非行動フェーズ（完了）は常に false（AC-22）', () => {
    const items = [makeItem({ id: 1, eventDate: '2026-07-01' })]
    expect(isAreaHot(areaDef('done'), items, TODAY)).toBe(false)
  })

  it('要対応：対象0件なら false', () => {
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
