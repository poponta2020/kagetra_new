import type { EventStatus } from '@kagetra/shared'

/**
 * travel-report: **遠征単位**の導出（requirements R4）。
 *
 * 遠征単位＝申込グループ内の**非 cancelled** な開催日を日付順に並べ、**連続する日**を
 * まとめたブロック。第1土日と第2土日なら2単位になる。経路入力・入力状況・
 * 「全員そろった」通知・遠征届のファイル分割の既定は、すべてこの単位で行う。
 *
 * ★単位テーブルは持たず**都度導出する**。キーはブロック初日（`startDate`）で、
 * `travel_routes.unit_start_date` / `travel_unit_notices.unit_start_date` がこれを指す。
 * 開催日が増減してブロックが割れたら、古いキーの行は読まれなくなるだけ（再キー付けは
 * しない）。新しいブロックは未入力・未通知として扱われ、そろえば改めて通知が飛ぶ
 * ——これが望ましい挙動なので、孤児行を掃除する処理も置かない。
 *
 * 日付は `YYYY-MM-DD` の文字列のまま扱う。`new Date('2026-06-13')` は UTC 解釈になり、
 * JST のローカル日付とずれることがあるため、**日付の加減算は UTC で行い文字列へ戻す**。
 */

export interface TravelUnitSourceEvent {
  id: number
  eventDate: string
  status: EventStatus
}

export interface TravelUnit {
  /** 単位のキー＝ブロック初日（`YYYY-MM-DD`）。 */
  startDate: string
  /** ブロック最終日（`YYYY-MM-DD`）。 */
  endDate: string
  /** ブロックに含まれる開催日（連続・昇順・重複なし）。 */
  dates: string[]
  /** ブロックに含まれる events.id（日付昇順 → id 昇順）。 */
  eventIds: number[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` を UTC のミリ秒へ。形式が違えば `NaN`。 */
export function dateToUtcMs(date: string): number {
  if (!DATE_RE.test(date)) return Number.NaN
  return Date.parse(`${date}T00:00:00Z`)
}

/** UTC ミリ秒を `YYYY-MM-DD` へ。 */
function utcMsToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * `YYYY-MM-DD` が実在する暦日かどうか（形式チェックも兼ねる）。
 *
 * `Date.parse('2026-02-31T00:00:00Z')` は NaN にならず 3/3 へロールオーバーする
 * （`2027-02-29` も 3/1 へ）ため、`dateToUtcMs` の形式チェックだけでは実在しない
 * 日付（うるう年でない年の 2/29 等）を通してしまう。UTC ミリ秒へ変換して文字列へ
 * 戻し、入力と一致するかまで確認する（Codex R1 #3）。
 */
export function isValidCalendarDate(date: string): boolean {
  const ms = dateToUtcMs(date)
  if (Number.isNaN(ms)) return false
  return utcMsToDate(ms) === date
}

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` に日数を足す（負数で戻る）。 */
export function addDays(date: string, days: number): string {
  return utcMsToDate(dateToUtcMs(date) + days * DAY_MS)
}

/** 2つの `YYYY-MM-DD` の差（日数。`to - from`）。 */
export function diffDays(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS)
}

/** 単位の暦日数（自〜至の暦日。届の「（N日間）」に使う）。 */
export function inclusiveDayCount(from: string, to: string): number {
  return diffDays(from, to) + 1
}

/**
 * 開催日の集合から遠征単位を導出する。
 *
 * - `status === 'cancelled'` の日は**除外**する（グループページの集約と同じ規律）
 * - 同じ日に複数の級（複数 events）があっても 1 日として扱う
 * - 日付が壊れている行は無視する（DB は date 型なので実際には来ない）
 */
export function buildTravelUnits(events: readonly TravelUnitSourceEvent[]): TravelUnit[] {
  const byDate = new Map<string, number[]>()
  for (const ev of events) {
    if (ev.status === 'cancelled') continue
    if (Number.isNaN(dateToUtcMs(ev.eventDate))) continue
    const ids = byDate.get(ev.eventDate)
    if (ids) ids.push(ev.id)
    else byDate.set(ev.eventDate, [ev.id])
  }

  const dates = [...byDate.keys()].sort()
  const units: TravelUnit[] = []
  for (const date of dates) {
    const last = units.at(-1)
    if (last && diffDays(last.endDate, date) === 1) {
      last.endDate = date
      last.dates.push(date)
      last.eventIds.push(...[...(byDate.get(date) ?? [])].sort((a, b) => a - b))
      continue
    }
    units.push({
      startDate: date,
      endDate: date,
      dates: [date],
      eventIds: [...(byDate.get(date) ?? [])].sort((a, b) => a - b),
    })
  }
  return units
}

/** 単位キー（ブロック初日）から単位を引く。無ければ `null`（開催日の増減で孤児化した状態）。 */
export function findTravelUnit(
  units: readonly TravelUnit[],
  unitStartDate: string,
): TravelUnit | null {
  return units.find((u) => u.startDate === unitStartDate) ?? null
}

/** ある開催日が属する単位を引く。 */
export function findUnitContainingDate(
  units: readonly TravelUnit[],
  date: string,
): TravelUnit | null {
  return units.find((u) => u.dates.includes(date)) ?? null
}

/** ある events.id が属する単位を引く。 */
export function findUnitContainingEvent(
  units: readonly TravelUnit[],
  eventId: number,
): TravelUnit | null {
  return units.find((u) => u.eventIds.includes(eventId)) ?? null
}
