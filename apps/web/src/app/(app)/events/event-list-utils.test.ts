import { describe, it, expect } from 'vitest'
import type { EventStatus, Grade } from '@kagetra/shared/types'
import {
  formatDeadlineCountdown,
  formatEventDay,
  groupEventsByMonth,
  isGradeEligible,
  isOpenForEntry,
  isPastDeadline,
  isRowVisible,
  sortEvents,
} from './event-list-utils'

describe('formatDeadlineCountdown', () => {
  const today = '2026-07-10'

  it('null deadline → dash / none', () => {
    expect(formatDeadlineCountdown(null, today)).toEqual({
      text: '—',
      tone: 'none',
      daysLeft: null,
    })
  })

  it('same day (daysLeft 0) → 本日 / today', () => {
    expect(formatDeadlineCountdown('2026-07-10', today)).toEqual({
      text: '本日',
      tone: 'today',
      daysLeft: 0,
    })
  })

  it('1 day left → soon', () => {
    expect(formatDeadlineCountdown('2026-07-11', today)).toEqual({
      text: 'あと1日',
      tone: 'soon',
      daysLeft: 1,
    })
  })

  it('3 days left → soon (upper boundary of soon)', () => {
    expect(formatDeadlineCountdown('2026-07-13', today)).toEqual({
      text: 'あと3日',
      tone: 'soon',
      daysLeft: 3,
    })
  })

  it('4 days left → normal (3↔4 boundary)', () => {
    expect(formatDeadlineCountdown('2026-07-14', today)).toEqual({
      text: 'あと4日',
      tone: 'normal',
      daysLeft: 4,
    })
  })

  it('past deadline (daysLeft < 0) → 締切済 / past', () => {
    expect(formatDeadlineCountdown('2026-07-09', today)).toEqual({
      text: '締切済',
      tone: 'past',
      daysLeft: -1,
    })
  })

  it('crosses a month boundary correctly', () => {
    // 2026-07-31 → 2026-08-02 is 2 days.
    expect(formatDeadlineCountdown('2026-08-02', '2026-07-31')).toEqual({
      text: 'あと2日',
      tone: 'soon',
      daysLeft: 2,
    })
  })

  it('malformed deadline → dash / none (defensive)', () => {
    expect(formatDeadlineCountdown('garbage', today)).toEqual({
      text: '—',
      tone: 'none',
      daysLeft: null,
    })
  })
})

// event-list-redesign: 締切超過の判定は formatDeadlineCountdown の past tone を
// 単一の真実として使う（しきい値ロジックを二重化しない）。
describe('isPastDeadline', () => {
  const today = '2026-07-10'

  it('昨日 → true', () => {
    expect(isPastDeadline('2026-07-09', today)).toBe(true)
  })

  it('当日 → false（締切当日はまだ超過していない）', () => {
    expect(isPastDeadline('2026-07-10', today)).toBe(false)
  })

  it('明日 → false', () => {
    expect(isPastDeadline('2026-07-11', today)).toBe(false)
  })

  it('締切未設定（null）→ false', () => {
    expect(isPastDeadline(null, today)).toBe(false)
  })

  it('不正な日付 → false（none tone・防御的）', () => {
    expect(isPastDeadline('garbage', today)).toBe(false)
  })
})

describe('isRowVisible', () => {
  const today = '2026-07-10'
  const row = (internalDeadline: string | null, viewerAttending = false) => ({
    internalDeadline,
    viewerAttending,
  })

  it('AC-1: 締切が昨日以前の行は表示しない', () => {
    expect(isRowVisible(row('2026-07-09'), today)).toBe(false)
  })

  it('AC-2: 締切超過でも自分が attend=true なら表示する', () => {
    expect(isRowVisible(row('2026-07-09', true), today)).toBe(true)
  })

  it('AC-3: 締切当日（daysLeft=0）は表示する', () => {
    expect(isRowVisible(row('2026-07-10'), today)).toBe(true)
  })

  it('締切が明日以降は表示する', () => {
    expect(isRowVisible(row('2026-07-11'), today)).toBe(true)
  })

  it('AC-4: 締切未設定（null）は表示する', () => {
    expect(isRowVisible(row(null), today)).toBe(true)
  })

  it('viewerAttending=true は締切に関係なく表示を妨げない', () => {
    expect(isRowVisible(row('2026-07-20', true), today)).toBe(true)
  })
})

describe('isOpenForEntry', () => {
  const today = '2026-07-10'
  const row = (
    over: Partial<{
      internalDeadline: string | null
      canApply: boolean
      status: EventStatus
    }> = {},
  ) => ({
    internalDeadline: '2026-07-20' as string | null,
    canApply: true,
    status: 'published' as EventStatus,
    ...over,
  })

  it('AC-8: canApply・未中止・締切内をすべて満たす → true（藍帯）', () => {
    expect(isOpenForEntry(row(), today)).toBe(true)
  })

  it('AC-8: canApply=false → false（砂帯）', () => {
    expect(isOpenForEntry(row({ canApply: false }), today)).toBe(false)
  })

  it('AC-9: 中止イベントは canApply=true でも false（砂帯）', () => {
    expect(isOpenForEntry(row({ status: 'cancelled' }), today)).toBe(false)
  })

  it('AC-8: 締切超過は canApply=true でも false（砂帯）', () => {
    expect(isOpenForEntry(row({ internalDeadline: '2026-07-09' }), today)).toBe(false)
  })

  it('締切当日は申込可能（true）', () => {
    expect(isOpenForEntry(row({ internalDeadline: '2026-07-10' }), today)).toBe(true)
  })

  it('締切未設定（null）は締切を理由に落とさない', () => {
    expect(isOpenForEntry(row({ internalDeadline: null }), today)).toBe(true)
  })
})

describe('isGradeEligible', () => {
  it('null eligibleGrades → eligible (対象級未設定=全級)', () => {
    expect(isGradeEligible(null, 'C')).toBe(true)
  })

  it('empty eligibleGrades → eligible', () => {
    expect(isGradeEligible([], 'C')).toBe(true)
  })

  it('grade included → eligible', () => {
    expect(isGradeEligible(['A', 'B'], 'B')).toBe(true)
  })

  it('grade not included → not eligible', () => {
    expect(isGradeEligible(['A', 'B'], 'C')).toBe(false)
  })

  it('grade=null with eligibleGrades set → not eligible', () => {
    expect(isGradeEligible(['A', 'B'], null)).toBe(false)
  })

  it('grade=null with no eligibleGrades → eligible', () => {
    expect(isGradeEligible(null, null)).toBe(true)
  })

  it('undefined eligibleGrades → eligible', () => {
    expect(isGradeEligible(undefined, 'C')).toBe(true)
  })
})

type Row = { id: number; eventDate: string; internalDeadline: string | null }
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('sortEvents', () => {
  const rows: Row[] = [
    { id: 1, eventDate: '2026-08-01', internalDeadline: '2026-07-20' },
    { id: 2, eventDate: '2026-07-15', internalDeadline: null },
    { id: 3, eventDate: '2026-07-10', internalDeadline: '2026-07-05' },
    { id: 4, eventDate: '2026-07-25', internalDeadline: null },
  ]

  it('date axis → eventDate ascending', () => {
    expect(ids(sortEvents(rows, 'date'))).toEqual([3, 2, 4, 1])
  })

  it('deadline axis → deadline ascending, nulls last (eventDate secondary within nulls)', () => {
    expect(ids(sortEvents(rows, 'deadline'))).toEqual([3, 1, 2, 4])
  })

  it('deadline axis → ties on deadline broken by eventDate ascending', () => {
    const tied: Row[] = [
      { id: 10, eventDate: '2026-09-02', internalDeadline: '2026-07-05' },
      { id: 11, eventDate: '2026-09-01', internalDeadline: '2026-07-05' },
    ]
    expect(ids(sortEvents(tied, 'deadline'))).toEqual([11, 10])
  })

  it('does not mutate the input array', () => {
    const before = ids(rows)
    sortEvents(rows, 'deadline')
    expect(ids(rows)).toEqual(before)
  })
})

// event-list-month-grouping タスク1: 開催日順ビューの月区切りに使う純関数。
// 期待値は design-mock/month-sections.html・edge-cases.html の実データに揃える。
describe('formatEventDay', () => {
  it('日はゼロ埋めしない（月見出しのゼロ埋めと対の意匠・design-spec §3-1）', () => {
    expect(formatEventDay('2026-09-05').day).toBe('5')
    expect(formatEventDay('2026-08-29').day).toBe('29')
  })

  it('英字曜日にマップする（装飾タイポとしての意図的例外・design-spec §3-3）', () => {
    // 2026-09-06(日) から 1 日ずつ進めて全曜日を通す。
    const week = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    const days = [
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]
    expect(days.map((d) => formatEventDay(d).weekday)).toEqual(week)
  })

  it('日曜=sun・土曜=sat・平日=weekday（日曜朱／土曜藍のカレンダー色則）', () => {
    expect(formatEventDay('2026-09-06').tone).toBe('sun')
    expect(formatEventDay('2026-08-29').tone).toBe('sat')
    expect(formatEventDay('2026-09-22').tone).toBe('weekday')
  })

  it('月をまたいでも曜日がずれない（UTC 深夜として解釈する）', () => {
    expect(formatEventDay('2026-10-11')).toEqual({
      day: '11',
      weekday: 'SUN',
      tone: 'sun',
    })
  })

  it('壊れた日付は空表示（防御的・formatDeadlineCountdown と同じ方針）', () => {
    expect(formatEventDay('garbage')).toEqual({
      day: '',
      weekday: '',
      tone: 'weekday',
    })
  })
})

describe('groupEventsByMonth', () => {
  const row = (eventDate: string) => ({ eventDate })
  const keys = (groups: { key: string }[]) => groups.map((g) => g.key)

  it('開催月ごとに束ね、月はゼロ埋め2桁・月名は英字（mock: 08 AUG / 09 SEP / 10 OCT）', () => {
    const groups = groupEventsByMonth([
      row('2026-08-29'),
      row('2026-09-05'),
      row('2026-09-06'),
      row('2026-10-11'),
    ])
    expect(groups.map((g) => [g.month, g.monthAbbr])).toEqual([
      ['08', 'AUG'],
      ['09', 'SEP'],
      ['10', 'OCT'],
    ])
    expect(groups.map((g) => g.rows.length)).toEqual([1, 2, 1])
  })

  it('月境界で分かれる（同月末と翌月頭は別グループ）', () => {
    const groups = groupEventsByMonth([row('2026-08-31'), row('2026-09-01')])
    expect(keys(groups)).toEqual(['2026-08', '2026-09'])
  })

  it('年跨ぎ: 年が変わる最初の月見出しにだけ西暦が付く（mock: 01 JAN のみ 2027）', () => {
    const groups = groupEventsByMonth([
      row('2026-12-13'),
      row('2027-01-10'),
      row('2027-02-11'),
    ])
    expect(groups.map((g) => [g.monthAbbr, g.year])).toEqual([
      ['DEC', null],
      ['JAN', '2027'],
      ['FEB', null],
    ])
  })

  it('先頭グループには西暦を出さない（今年が起点＝文脈で判る）', () => {
    expect(groupEventsByMonth([row('2027-01-10')])[0]?.year).toBeNull()
  })

  it('フィルタで 1 行も残らなかった月はグループに現れない（空セクションを出さない）', () => {
    // 9月の行がフィルタで全部落ちた状態。8月→10月へ飛ぶ。
    const groups = groupEventsByMonth([row('2026-08-29'), row('2026-10-11')])
    expect(keys(groups)).toEqual(['2026-08', '2026-10'])
  })

  it('渡された行の並びを崩さない（連続グルーピング・非破壊）', () => {
    const rows = [row('2026-09-05'), row('2026-09-06'), row('2026-10-11')]
    const before = rows.slice()
    const groups = groupEventsByMonth(rows)
    expect(groups.flatMap((g) => g.rows)).toEqual(before)
    expect(rows).toEqual(before)
  })

  it('0 件なら空配列', () => {
    expect(groupEventsByMonth([])).toEqual([])
  })

  // 前提（開催日昇順）が崩れた入力での挙動を固定しておく。実運用では
  // page.tsx が eventDate,id 順で取り、sortEvents('date') が安定ソートなので
  // 起きないが、連続グルーピングである以上「同月が2つに割れる」ことは
  // 仕様として明示しておかないと、将来 sortEvents を触ったときに月見出しが
  // 重複する形で静かに壊れる。
  it('開催日昇順でない入力は同月でも連続していなければ別グループになる（前提の明示）', () => {
    const groups = groupEventsByMonth([
      row('2026-09-05'),
      row('2026-08-29'),
      row('2026-09-06'),
    ])
    expect(keys(groups)).toEqual(['2026-09', '2026-08', '2026-09'])
  })
})

// Type-level guard: eligibleGrades accepts Grade[] shape.
const _grades: Grade[] = ['A', 'E']
void _grades
