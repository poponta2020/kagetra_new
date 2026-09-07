import { z } from 'zod'
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_LABEL_FROM_HOMETOWN,
  DEFAULT_DEPARTURE_PLACE,
  type TravelLeg,
  type TravelWayKind,
} from '@kagetra/shared'
import { addDays, diffDays, isValidCalendarDate } from './units'

/**
 * travel-report: 経路（行き／帰りの3択＋移動行の並び）の**純関数**（requirements R6）。
 *
 * DB アクセスを持たないのは、既定行の生成・差し替え・入力検証が S8 のクライアント側と
 * Server Action の両方から同じ規則で使われるため（`entry-fee.ts` と `entry-fee-tally.ts`
 * の分離と同じ流儀）。
 *
 * ★**大会出場の行は保存しない。** その人の出欠「参加」の日から都度導出する
 * （`buildAttendanceRows`）。出欠が変わっても経路が stale にならない。
 */

/** 移動行の地名の最大長。 */
export const PLACE_MAX_LENGTH = 40
/** 移動行の上限。 */
export const LEGS_MAX_ROWS = 30
/** 移動行の日付が単位から離れてよい日数。 */
export const LEG_DATE_SLACK_DAYS = 14

// ---------------------------------------------------------------------------
// 既定の行程（R6）
// ---------------------------------------------------------------------------

export interface DefaultLegInput {
  departureKind: TravelWayKind
  departurePlace: string | null
  returnKind: TravelWayKind
  returnPlace: string | null
  /** 本人の出場日（`YYYY-MM-DD`・昇順）。**単位の初日／最終日ではない**（R6）。 */
  attendanceDates: readonly string[]
  /** 開催地（経路表記名）。未設定なら該当欄は空欄になる。 */
  destinationLabel: string | null
}

/**
 * 行きの既定行。
 * - `sapporo` → 最初の出場日の**前日**に「札幌→{開催地}」
 * - `hometown`（帰省先から出場）→ 往路の既定行**なし**
 * - `other` → 前日に「{地名}→{開催地}」
 * 出場日が無ければ `null`。開催地が未設定なら到着地を空欄にした行を返す。
 */
export function buildDefaultOutboundLeg(input: DefaultLegInput): TravelLeg | null {
  const first = input.attendanceDates[0]
  if (!first) return null
  if (input.departureKind === 'hometown') return null
  const from =
    input.departureKind === 'sapporo' ? DEFAULT_DEPARTURE_PLACE : (input.departurePlace ?? '')
  return { date: addDays(first, -1), from, to: input.destinationLabel ?? '' }
}

/**
 * 帰りの既定行。
 * - `sapporo` → 最後の出場日の**翌日**に「{開催地}→札幌」
 * - `hometown`（そのまま帰省）→ 復路の既定行**なし**
 * - `other` → 翌日に「{開催地}→{地名}」
 */
export function buildDefaultReturnLeg(input: DefaultLegInput): TravelLeg | null {
  const last = input.attendanceDates.at(-1)
  if (!last) return null
  if (input.returnKind === 'hometown') return null
  const to = input.returnKind === 'sapporo' ? DEFAULT_DEPARTURE_PLACE : (input.returnPlace ?? '')
  return { date: addDays(last, 1), from: input.destinationLabel ?? '', to }
}

/** 行き・帰りの既定行をまとめて返す（日付昇順）。 */
export function buildDefaultLegs(input: DefaultLegInput): TravelLeg[] {
  return [buildDefaultOutboundLeg(input), buildDefaultReturnLeg(input)].filter(
    (leg): leg is TravelLeg => leg !== null,
  )
}

const sameLeg = (a: TravelLeg, b: TravelLeg) => a.date === b.date && a.from === b.from && a.to === b.to

/**
 * 行き／帰りの選択を変えたときの差し替え（R6・AC-14）。
 *
 * **前の選択で生成された既定行だけを取り除き、新しい既定行を差し込む。**
 * 本人が足した行・編集した行は残る（前の既定行と完全一致するものだけを消すため、
 * 既定行を手で書き換えていればそれは「本人が足した行」として残る）。
 */
export function applyWayChange(
  legs: readonly TravelLeg[],
  previousDefaults: readonly TravelLeg[],
  nextDefaults: readonly TravelLeg[],
): TravelLeg[] {
  const remaining = [...legs]
  for (const stale of previousDefaults) {
    const i = remaining.findIndex((leg) => sameLeg(leg, stale))
    if (i !== -1) remaining.splice(i, 1)
  }
  // 既に同じ行があるなら重ねない（同じ選択を選び直したとき）。
  const additions = nextDefaults.filter((next) => !remaining.some((leg) => sameLeg(leg, next)))
  return sortLegs([...remaining, ...additions])
}

/** 日付昇順に整える（同じ日は元の順序を保つ＝安定ソート）。 */
export function sortLegs(legs: readonly TravelLeg[]): TravelLeg[] {
  return [...legs]
    .map((leg, i) => ({ leg, i }))
    .sort((a, b) => (a.leg.date === b.leg.date ? a.i - b.i : a.leg.date < b.leg.date ? -1 : 1))
    .map(({ leg }) => leg)
}

// ---------------------------------------------------------------------------
// 大会出場の行（保存しない・導出のみ。R6）
// ---------------------------------------------------------------------------

export interface AttendanceRow {
  date: string
  label: string
}

/**
 * その人の出場日から「大会出場」の行を導出する。
 * 表記が変わるのは**行きが `hometown`（帰省先から出場）のときだけ**（R6・AC-14）。
 * `other` は出場表記を変えず、移動行で表す。
 */
export function buildAttendanceRows(
  attendanceDates: readonly string[],
  departureKind: TravelWayKind,
): AttendanceRow[] {
  const label = departureKind === 'hometown' ? ATTENDANCE_LABEL_FROM_HOMETOWN : ATTENDANCE_LABEL
  return [...attendanceDates].sort().map((date) => ({ date, label }))
}

// ---------------------------------------------------------------------------
// 入力検証（Server Action 境界。R6・AC-14）
// ---------------------------------------------------------------------------

const wayKind = z.enum(['sapporo', 'hometown', 'other'])

const legSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付の形式が不正です')
    .refine(isValidCalendarDate, '実在する日付を入力してください'),
  from: z.string().trim().min(1, '出発地を入力してください').max(PLACE_MAX_LENGTH, `出発地は${PLACE_MAX_LENGTH}文字以内で入力してください`),
  to: z.string().trim().min(1, '到着地を入力してください').max(PLACE_MAX_LENGTH, `到着地は${PLACE_MAX_LENGTH}文字以内で入力してください`),
})

export const travelRouteInputSchema = z
  .object({
    departureKind: wayKind,
    departurePlace: z.string().trim().max(PLACE_MAX_LENGTH).nullable().optional(),
    returnKind: wayKind,
    returnPlace: z.string().trim().max(PLACE_MAX_LENGTH).nullable().optional(),
    legs: z.array(legSchema).max(LEGS_MAX_ROWS, `移動は${LEGS_MAX_ROWS}行までです`),
  })
  // 行き／帰りが `その他` なら地名が要る（AC-14）。
  .refine((v) => v.departureKind !== 'other' || (v.departurePlace ?? '').length > 0, {
    message: '行きの地名を入力してください',
    path: ['departurePlace'],
  })
  .refine((v) => v.returnKind !== 'other' || (v.returnPlace ?? '').length > 0, {
    message: '帰りの地名を入力してください',
    path: ['returnPlace'],
  })

export type TravelRouteInput = z.infer<typeof travelRouteInputSchema>

/**
 * 遠征単位の前後 ±14 日に収まっているかを検査する（`travelRouteInputSchema` の後に呼ぶ）。
 * 単位に依存するのでスキーマ本体から分けている。
 */
export function validateLegDates(
  legs: readonly TravelLeg[],
  unit: { startDate: string; endDate: string },
): string | null {
  for (const leg of legs) {
    // ★スキーマ側（`legSchema`）で実在日を検証済みだが、このヘルパー単体で呼ばれる
    // 場合もあるため二重の網として NaN（不正日付）を範囲外扱いで弾く（Codex R1 #3）。
    if (!isValidCalendarDate(leg.date)) {
      return '実在する日付を入力してください'
    }
    if (diffDays(unit.startDate, leg.date) < -LEG_DATE_SLACK_DAYS) {
      return `開催日の${LEG_DATE_SLACK_DAYS}日前より古い日付は入力できません`
    }
    if (diffDays(unit.endDate, leg.date) > LEG_DATE_SLACK_DAYS) {
      return `開催日の${LEG_DATE_SLACK_DAYS}日後より先の日付は入力できません`
    }
  }
  return null
}

/**
 * 保存直前の正規化。`その他` 以外の地名は捨てる（選択と地名の食い違いを残さない）。
 */
export function normalizeRouteInput(input: TravelRouteInput): {
  departureKind: TravelWayKind
  departurePlace: string | null
  returnKind: TravelWayKind
  returnPlace: string | null
  legs: TravelLeg[]
} {
  return {
    departureKind: input.departureKind,
    departurePlace: input.departureKind === 'other' ? (input.departurePlace ?? null) : null,
    returnKind: input.returnKind,
    returnPlace: input.returnKind === 'other' ? (input.returnPlace ?? null) : null,
    legs: sortLegs(
      input.legs.map((leg) => ({ date: leg.date, from: leg.from.trim(), to: leg.to.trim() })),
    ),
  }
}
