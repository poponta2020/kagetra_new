import type { EventStatus, Grade } from '@kagetra/shared/types'

/**
 * Pure display/sort helpers for the `/events` list ("大会申込").
 *
 * These are deterministic given their inputs — none of them read `Date.now()`.
 * The server passes `todayStr` (JST) down so the client renders the same
 * countdown it computed server-side (no hydration mismatch). Requirements:
 * docs/features/event-list-refinements/requirements.md §3.1 / §4.3.
 */

/** Sort axes for the list toggle. Ascending only (see requirements ④). */
export type SortAxis = 'deadline' | 'date'

/** Countdown emphasis buckets (see design-spec §5 / requirements ③). */
export type DeadlineTone = 'today' | 'soon' | 'normal' | 'past' | 'none'

/** Days-left threshold below which the countdown is emphasised (soon bucket). */
export const SOON_THRESHOLD = 3

/** Minimal serialisable row the client list renders (see requirements §4.3). */
export interface EventListItem {
  id: number
  title: string
  eventDate: string
  internalDeadline: string | null
  status: EventStatus
  /** `isGradeEligible(eligibleGrades, myGrade)` computed on the server. */
  canApply: boolean
  /** Total `attend=true` count (unchanged "参加 N名" semantics). */
  attendCount: number
  /**
   * Surnames of every `attend=true` participant, grade-ascending (unset last).
   * event-list-redesign: the CHIP_LIMIT slice was dropped — rows render all of
   * them, so there is no "他N名" remainder to compute.
   */
  attendeeSurnames: string[]
  /**
   * Whether the viewing user answered `attend=true` for this event. Only used
   * to keep past-deadline rows visible for people who already applied
   * (requirements §2.1) — it is not rendered anywhere.
   */
  viewerAttending: boolean
}

/** Midnight-UTC epoch ms for a `YYYY-MM-DD` string, or null if malformed. */
function toEpochDay(dateStr: string): number | null {
  const ms = Date.parse(`${dateStr}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Internal-deadline countdown relative to JST today (`todayStr`, `YYYY-MM-DD`).
 * `daysLeft = internalDeadline − today` (whole days):
 *   - > 3  → 「あと{n}日」 normal
 *   - 1..3 → 「あと{n}日」 soon (emphasised)
 *   - 0    → 「本日」      today (accent)
 *   - < 0  → 「締切済」    past (muted)
 *   - null → 「—」         none (row kept, dash)
 *
 * `daysLeft` is returned alongside `text` because the redesign renders the
 * number at a larger size than the surrounding 「あと」「日」 (design-spec
 * 忠実度チェックリスト). It is `null` whenever there is no countdown to show
 * (`none`), and 0 on the 「本日」 pill which prints no digits.
 */
export function formatDeadlineCountdown(
  internalDeadline: string | null,
  todayStr: string,
): { text: string; tone: DeadlineTone; daysLeft: number | null } {
  if (internalDeadline == null) return { text: '—', tone: 'none', daysLeft: null }
  const deadline = toEpochDay(internalDeadline)
  const today = toEpochDay(todayStr)
  if (deadline == null || today == null) return { text: '—', tone: 'none', daysLeft: null }

  const daysLeft = Math.round((deadline - today) / 86_400_000)
  if (daysLeft < 0) return { text: '締切済', tone: 'past', daysLeft }
  if (daysLeft === 0) return { text: '本日', tone: 'today', daysLeft }
  if (daysLeft <= SOON_THRESHOLD) return { text: `あと${daysLeft}日`, tone: 'soon', daysLeft }
  return { text: `あと${daysLeft}日`, tone: 'normal', daysLeft }
}

/**
 * 会内締切が過ぎているか。`formatDeadlineCountdown` の `past` tone を**唯一の
 * 真実**として使う（しきい値ロジックを二重化しない）。締切未設定（null）は
 * 「超過していない」＝ false。
 */
export function isPastDeadline(internalDeadline: string | null, todayStr: string): boolean {
  return formatDeadlineCountdown(internalDeadline, todayStr).tone === 'past'
}

/**
 * 行を一覧に出すか（requirements §2.1）。締切超過の行は原則隠すが、閲覧者
 * 自身が出欠回答済み（attend=true）の行は「申し込んだかの確認」導線として
 * 残す。締切当日（daysLeft=0）・締切未設定（null）は past ではないので表示。
 *
 * 自分の attend 状態でユーザーごとに行集合が変わるため、サーバー側の母集団
 * 条件ではなく表示フィルタとして適用する。
 */
export function isRowVisible(
  item: Pick<EventListItem, 'internalDeadline' | 'viewerAttending'>,
  todayStr: string,
): boolean {
  return !isPastDeadline(item.internalDeadline, todayStr) || item.viewerAttending
}

/**
 * 行左端の色帯を藍にするか（design-spec Round 5）＝「今この行から申し込める」。
 * `canApply`（級のみ判定）は不変のまま、中止と締切超過を重ねて判定する。
 * false の行は砂帯。
 */
export function isOpenForEntry(
  item: Pick<EventListItem, 'internalDeadline' | 'canApply' | 'status'>,
  todayStr: string,
): boolean {
  return (
    item.canApply &&
    item.status !== 'cancelled' &&
    !isPastDeadline(item.internalDeadline, todayStr)
  )
}

/**
 * ⑦ 申込可能判定（級のみ）。対象級が未設定＝全級可。それ以外は自分の級が
 * 対象級に含まれれば可。grade=null は対象級ありなら不可（締切・中止は見ない）。
 */
export function isGradeEligible(
  eligibleGrades: Grade[] | null | undefined,
  grade: Grade | null | undefined,
): boolean {
  if (!eligibleGrades || eligibleGrades.length === 0) return true
  return grade != null && eligibleGrades.includes(grade)
}

/**
 * 月見出しの英字月名と日付ブロックの英字曜日（event-list-month-grouping）。
 * 「UI 文言は日本語のみ」原則に対する**意図的な例外**で、日付まわりの装飾
 * タイポとしてユーザー承認済み（design-spec §3-3・2026-07-28）。
 * 規約違反として日本語へ直さないこと。
 */
const MONTH_ABBR = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const
const WEEKDAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

/** 日付ブロックの曜日色（日曜=朱・土曜=藍・平日=淡墨。design-spec §2-3）。 */
export type WeekdayTone = 'sun' | 'sat' | 'weekday'

/** 行頭の日付ブロック 1 つぶんの表示値（design-spec §2-3）。 */
export interface EventDayLabel {
  /** 日。**ゼロ埋めしない**（'5' / '29'）— 月見出しのゼロ埋めと対の意匠。 */
  day: string
  /** 英字曜日（'SUN'…）。日付が壊れていたら空。 */
  weekday: string
  tone: WeekdayTone
}

/**
 * `YYYY-MM-DD` を行頭の日付ブロックの表示値へ畳む。曜日は UTC 深夜として解釈
 * する（`eventDate` は時刻を持たない JST の暦日文字列なので、ローカル時刻で
 * 解釈すると環境によって日がずれる）。
 */
export function formatEventDay(dateStr: string): EventDayLabel {
  const ms = toEpochDay(dateStr)
  if (ms == null) return { day: '', weekday: '', tone: 'weekday' }
  const date = new Date(ms)
  const dow = date.getUTCDay()
  return {
    day: String(date.getUTCDate()),
    weekday: WEEKDAY_ABBR[dow] ?? '',
    tone: dow === 0 ? 'sun' : dow === 6 ? 'sat' : 'weekday',
  }
}

/** 開催日順ビューの月セクション 1 つ（design-spec §2-1/2-2/2-6）。 */
export interface MonthGroup<T> {
  /** `YYYY-MM`。React の key に使う。 */
  key: string
  /** 見出しの数字。**ゼロ埋め 2 桁**（'08'）— 通年で数字幅が揃う。 */
  month: string
  /** 英字月名（'AUG'）。 */
  monthAbbr: string
  /**
   * 見出し右端の西暦。**年が変わる最初の月見出しにだけ**入り、それ以外は null。
   * 毎見出しに年を出すと「見出し＝数字の装置」が薄まるため（design-spec §2-6）。
   */
  year: string | null
  rows: T[]
}

/**
 * 開催月ごとに行を束ねる（design-spec §2-1）。**開催日昇順に並んだ行**が前提の
 * 連続グルーピングで、離れた同月の行はまとめない（渡された並びを崩さない）。
 *
 * グループは渡された行からのみ導出するので、フィルタで 1 行も残らなかった月は
 * そもそも現れない＝空の月セクションが出ない。
 */
export function groupEventsByMonth<T extends { eventDate: string }>(
  rows: T[],
): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = []
  let prevYear: string | null = null

  for (const row of rows) {
    const key = row.eventDate.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.rows.push(row)
      continue
    }
    const month = key.slice(5, 7)
    const year = key.slice(0, 4)
    groups.push({
      key,
      month,
      monthAbbr: MONTH_ABBR[Number(month) - 1] ?? '',
      year: prevYear != null && year !== prevYear ? year : null,
      rows: [row],
    })
    prevYear = year
  }

  return groups
}

/** Lexicographic compare (YYYY-MM-DD strings sort chronologically). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

type SortableEvent = { eventDate: string; internalDeadline: string | null }

/**
 * ④ ソート（昇順固定・非破壊）。
 *   - `date`     : eventDate 昇順。
 *   - `deadline` : internalDeadline 昇順・null は末尾・eventDate を副キー。
 * Array.sort is stable, so equal keys keep their incoming order.
 */
export function sortEvents<T extends SortableEvent>(list: T[], axis: SortAxis): T[] {
  const copy = list.slice()
  if (axis === 'date') {
    copy.sort((a, b) => cmp(a.eventDate, b.eventDate))
    return copy
  }
  copy.sort((a, b) => {
    const aNull = a.internalDeadline == null
    const bNull = b.internalDeadline == null
    if (aNull && bNull) return cmp(a.eventDate, b.eventDate)
    if (aNull) return 1
    if (bNull) return -1
    const byDeadline = cmp(a.internalDeadline as string, b.internalDeadline as string)
    return byDeadline !== 0 ? byDeadline : cmp(a.eventDate, b.eventDate)
  })
  return copy
}
