import {
  ATTENDANCE_LABEL,
  ATTENDANCE_LABEL_FROM_HOMETOWN,
  schoolYearRank,
  type TravelLeg,
  type TravelWayKind,
} from '@kagetra/shared'
import { dateToUtcMs, inclusiveDayCount } from './units'

/**
 * travel-report: 届に載せる値を組み立てる**純関数**（requirements R10）。
 *
 * docx の書き込み（`docx/fill.ts`）とは分けてある。名簿の並び・備考の集約・期間の
 * 計算は仕様の中身そのもので、XML 操作と混ぜるとテストが書けなくなるため。
 */

export interface TravelReportMember {
  userId: string
  /** `users.name`（表示名）。分割氏名が無い会員のフォールバック。 */
  displayName: string
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
  faculty: string | null
  schoolYear: string | null
  phone: string | null
}

export interface TravelReportRoute {
  userId: string
  departureKind: TravelWayKind
  legs: TravelLeg[]
  /** その人がこのファイルで出場する日（`YYYY-MM-DD`）。 */
  attendanceDates: string[]
}

// ---------------------------------------------------------------------------
// 氏名
// ---------------------------------------------------------------------------

const stripSpaces = (s: string) => s.replace(/[\s　]+/g, '')

/** 名簿の氏名＝姓と名をスペース無しで連結。分割氏名が無ければ表示名から空白を除く。 */
export function rosterFullName(m: TravelReportMember): string {
  if (m.familyName && m.givenName) return `${stripSpaces(m.familyName)}${stripSpaces(m.givenName)}`
  return stripSpaces(m.displayName)
}

/** 備考で使う姓。分割氏名が無ければ表示名の先頭トークン。 */
export function surnameOf(m: TravelReportMember): string {
  if (m.familyName) return stripSpaces(m.familyName)
  const head = m.displayName.trim().split(/[\s　]+/)[0] ?? ''
  return stripSpaces(head) || stripSpaces(m.displayName)
}

/** 名簿の並べ替えに使うかな。無ければ `null`（末尾へ送る）。 */
function kanaKey(m: TravelReportMember): string | null {
  const family = m.familyKana?.trim()
  if (!family) return null
  return `${family}${m.givenKana?.trim() ?? ''}`
}

/**
 * 名簿の並び（R10）: 学年の高い順 → 同学年はかな順 →
 * かなが無い（ゲスト等）は末尾で氏名順。最後に userId で安定させる。
 */
export function sortRosterMembers(members: readonly TravelReportMember[]): TravelReportMember[] {
  return [...members].sort((a, b) => {
    const yr = schoolYearRank(a.schoolYear) - schoolYearRank(b.schoolYear)
    if (yr !== 0) return yr
    const ka = kanaKey(a)
    const kb = kanaKey(b)
    if (ka !== null && kb !== null) {
      const c = ka.localeCompare(kb, 'ja')
      if (c !== 0) return c
    } else if (ka !== null) {
      return -1
    } else if (kb !== null) {
      return 1
    }
    const n = rosterFullName(a).localeCompare(rosterFullName(b), 'ja')
    return n !== 0 ? n : a.userId.localeCompare(b.userId)
  })
}

/**
 * 備考で**フルネームにする姓**（同姓が複数いる人だけフルネーム。R10）。
 * 名簿全体で姓が重複している人の userId 集合を返す。
 */
export function duplicatedSurnameUserIds(members: readonly TravelReportMember[]): Set<string> {
  const bySurname = new Map<string, string[]>()
  for (const m of members) {
    const s = surnameOf(m)
    const ids = bySurname.get(s)
    if (ids) ids.push(m.userId)
    else bySurname.set(s, [m.userId])
  }
  const out = new Set<string>()
  for (const ids of bySurname.values()) {
    if (ids.length > 1) for (const id of ids) out.add(id)
  }
  return out
}

// ---------------------------------------------------------------------------
// 期間・令和
// ---------------------------------------------------------------------------

/** 令和の年（西暦 − 2018）。令和1年＝2019。 */
export function reiwaYear(isoDate: string): number {
  return Number(isoDate.slice(0, 4)) - 2018
}

export interface EraDate {
  reiwa: number
  month: number
  day: number
}

/** `YYYY-MM-DD` を令和の年月日へ。 */
export function toEraDate(isoDate: string): EraDate {
  return {
    reiwa: reiwaYear(isoDate),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  }
}

export interface TravelPeriod {
  from: string
  to: string
  /** 暦日数（自至を含む）。 */
  days: number
}

/**
 * 期間（R10）: そのファイルの出場者全員の行——**移動行と出場日の両方**——の
 * 最小日を「自」、最大日を「至」、暦日数を「（N日間）」。
 * 行が1つも無ければ `null`。
 */
export function computePeriod(routes: readonly TravelReportRoute[]): TravelPeriod | null {
  const dates: string[] = []
  for (const r of routes) {
    for (const leg of r.legs) if (!Number.isNaN(dateToUtcMs(leg.date))) dates.push(leg.date)
    for (const d of r.attendanceDates) if (!Number.isNaN(dateToUtcMs(d))) dates.push(d)
  }
  if (dates.length === 0) return null
  const sorted = [...dates].sort()
  // 上で length > 0 を確かめているので両端は必ず取れる。
  const from = sorted[0]!
  const to = sorted[sorted.length - 1]!
  return { from, to, days: inclusiveDayCount(from, to) }
}

// ---------------------------------------------------------------------------
// 備考（R10・AC-23）
// ---------------------------------------------------------------------------

/**
 * 同一日内の並び順（R10）: 開催地へ向かう移動 → 大会出場 → 開催地から離れる移動 →
 * その他の移動。`const enum` は isolatedModules で使えないのでオブジェクトで持つ。
 */
const ContentOrder = {
  TowardDestination: 0,
  Attendance: 1,
  AwayFromDestination: 2,
  Other: 3,
} as const
type ContentOrder = (typeof ContentOrder)[keyof typeof ContentOrder]

/** 移動行が開催地へ向かうのか離れるのかを判定する。開催地が未設定なら「その他」。 */
function legOrder(leg: TravelLeg, destinationLabel: string | null): ContentOrder {
  if (!destinationLabel) return ContentOrder.Other
  if (leg.to === destinationLabel) return ContentOrder.TowardDestination
  if (leg.from === destinationLabel) return ContentOrder.AwayFromDestination
  return ContentOrder.Other
}

export interface RemarkEntry {
  date: string
  /** 「M/D [姓、姓]内容 [姓]内容 …」の1行。 */
  text: string
}

export interface BuildRemarksInput {
  /** 名簿順（`sortRosterMembers` の結果）。備考の姓の並びもこの順に従う。 */
  members: readonly TravelReportMember[]
  routes: readonly TravelReportRoute[]
  /** 開催地（経路表記名）。同一日内の並び順の判定に使う。 */
  destinationLabel: string | null
}

/**
 * 備考を組み立てる（R10・AC-23）。
 *
 * - 日付順に1日1段落
 * - 同一内容（同じ出発地→到着地／同じ出場表記）の人をまとめて `[姓、姓]内容`
 * - 姓は名簿順。**同姓が複数いる人だけフルネーム**
 * - 同一日内の順は 開催地へ向かう移動 → 大会出場 → 開催地から離れる移動 → その他の移動
 */
export function buildRemarks(input: BuildRemarksInput): RemarkEntry[] {
  const order = new Map(input.members.map((m, i) => [m.userId, i]))
  const dupSurnames = duplicatedSurnameUserIds(input.members)
  const byId = new Map(input.members.map((m) => [m.userId, m]))

  const nameOf = (userId: string): string => {
    const m = byId.get(userId)
    if (!m) return ''
    return dupSurnames.has(userId) ? rosterFullName(m) : surnameOf(m)
  }

  // date -> content -> { userIds, order, firstSeen }
  type Group = { userIds: string[]; order: ContentOrder; firstSeen: number }
  const byDate = new Map<string, Map<string, Group>>()

  const add = (
    date: string,
    content: string,
    userId: string,
    ord: ContentOrder,
  ) => {
    const forDate = byDate.get(date) ?? new Map<string, Group>()
    byDate.set(date, forDate)
    const g = forDate.get(content)
    const rank = order.get(userId) ?? Number.MAX_SAFE_INTEGER
    if (g) {
      g.userIds.push(userId)
      g.firstSeen = Math.min(g.firstSeen, rank)
    } else {
      forDate.set(content, { userIds: [userId], order: ord, firstSeen: rank })
    }
  }

  for (const route of input.routes) {
    // 名簿に載っていない人（対象外）の行は載せない。
    if (!byId.has(route.userId)) continue
    for (const leg of route.legs) {
      add(leg.date, `${leg.from}→${leg.to}`, route.userId, legOrder(leg, input.destinationLabel))
    }
    const label =
      route.departureKind === 'hometown' ? ATTENDANCE_LABEL_FROM_HOMETOWN : ATTENDANCE_LABEL
    for (const date of route.attendanceDates) {
      add(date, label, route.userId, ContentOrder.Attendance)
    }
  }

  const dates = [...byDate.keys()].sort()
  const out: RemarkEntry[] = []
  for (const date of dates) {
    const groups = [...(byDate.get(date) ?? new Map<string, Group>()).entries()].sort((a, b) => {
      if (a[1].order !== b[1].order) return a[1].order - b[1].order
      return a[1].firstSeen - b[1].firstSeen
    })
    const parts = groups.map(([content, g]) => {
      const names = [...new Set(g.userIds)]
        .sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0))
        .map(nameOf)
        .filter((n) => n.length > 0)
      return `[${names.join('、')}]${content}`
    })
    const month = Number(date.slice(5, 7))
    const day = Number(date.slice(8, 10))
    out.push({ date, text: `${month}/${day} ${parts.join(' ')}` })
  }
  return out
}

// ---------------------------------------------------------------------------
// 団体代表者（R10）
// ---------------------------------------------------------------------------

/** 団体代表者の所属欄「{学部等名} {学年}」。どちらも無ければ空文字。 */
export function affiliationLine(m: Pick<TravelReportMember, 'faculty' | 'schoolYear'>): string {
  return [m.faculty ?? '', m.schoolYear ?? ''].filter((s) => s.length > 0).join(' ')
}
