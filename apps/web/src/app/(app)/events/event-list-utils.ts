import type { Grade } from '@kagetra/shared/types'

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

/** Max surname chips rendered per row before collapsing into "他N名". */
export const CHIP_LIMIT = 5

/** Minimal serialisable row the client list renders (see requirements §4.3). */
export interface EventListItem {
  id: number
  title: string
  eventDate: string
  internalDeadline: string | null
  status: string
  /** `isGradeEligible(eligibleGrades, myGrade)` computed on the server. */
  canApply: boolean
  /** Total `attend=true` count (unchanged "参加 N名" semantics). */
  attendCount: number
  /** Leading surnames (up to CHIP_LIMIT), grade-ascending. */
  chipSurnames: string[]
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Midnight-UTC epoch ms for a `YYYY-MM-DD` string, or null if malformed. */
function toEpochDay(dateStr: string): number | null {
  const ms = Date.parse(`${dateStr}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * `YYYY-MM-DD` → `M/D(曜)` (no zero-padding, weekday in Japanese).
 * e.g. `2026-07-12` → `7/12(日)`. The weekday is computed from the calendar
 * date via a UTC construction so it's timezone-independent and deterministic.
 * Returns the input unchanged if it isn't a `YYYY-MM-DD` string (defensive).
 */
export function formatEventDate(eventDate: string): string {
  const m = DATE_RE.exec(eventDate)
  if (!m) return eventDate
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${month}/${day}(${WEEKDAY_JA[dow]})`
}

/**
 * Internal-deadline countdown relative to JST today (`todayStr`, `YYYY-MM-DD`).
 * `daysLeft = internalDeadline − today` (whole days):
 *   - > 3  → 「あと{n}日」 normal
 *   - 1..3 → 「あと{n}日」 soon (emphasised)
 *   - 0    → 「本日」      today (accent)
 *   - < 0  → 「締切済」    past (muted)
 *   - null → 「—」         none (row kept, dash)
 */
export function formatDeadlineCountdown(
  internalDeadline: string | null,
  todayStr: string,
): { text: string; tone: DeadlineTone } {
  if (internalDeadline == null) return { text: '—', tone: 'none' }
  const deadline = toEpochDay(internalDeadline)
  const today = toEpochDay(todayStr)
  if (deadline == null || today == null) return { text: '—', tone: 'none' }

  const daysLeft = Math.round((deadline - today) / 86_400_000)
  if (daysLeft < 0) return { text: '締切済', tone: 'past' }
  if (daysLeft === 0) return { text: '本日', tone: 'today' }
  if (daysLeft <= SOON_THRESHOLD) return { text: `あと${daysLeft}日`, tone: 'soon' }
  return { text: `あと${daysLeft}日`, tone: 'normal' }
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
