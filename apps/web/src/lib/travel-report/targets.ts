import 'server-only'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  entryGroupTravelSettings,
  eventAttendances,
  events,
  travelRoutes,
  users,
} from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { getEffectiveSelectionStatuses } from './selection-status'
import { buildTravelUnits, type TravelUnit } from './units'

/**
 * travel-report: 遠征単位ごとの**対象者**と入力状況（requirements R4・R5・AC-12）。
 *
 * 対象者 ＝ サークル所属 ON ∧ その単位のいずれかの日に出欠「参加」 ∧
 * 有効な確定状況が「確定」∧ 退会済みでない。会員・ゲストの両方を含む。
 *
 * 「有効な確定状況」の導出は `selection-status.ts` の1箇所に閉じる（このモジュールは
 * その結果を使うだけ）。
 */

export interface TravelTarget {
  userId: string
  /** 表示名（`users.name`）。 */
  name: string | null
  isGuest: boolean
  /** その人がこの単位で出場する日（`YYYY-MM-DD`・昇順）。既定行の基準になる。 */
  attendanceDates: string[]
  /** この単位の経路を1回以上保存しているか（移動0行でも入力済み）。 */
  entered: boolean
}

export interface TravelUnitStatus {
  unit: TravelUnit
  targets: TravelTarget[]
  /** 未入力の対象者の userId。 */
  pendingUserIds: string[]
}

export interface GroupTravelContext {
  entryGroupId: number
  units: TravelUnit[]
  /** 遠征届が必要か（設定行が無ければ既定 true）。 */
  required: boolean
  /** 提出権限者が「経路入力を開始」を押した日時。 */
  routeInputStartedAt: Date | null
  destinationLabel: string | null
  destinationPrefecture: string | null
  destinationCity: string | null
  destinationSource: 'ai' | 'manual' | null
  destinationAttemptedAt: Date | null
}

/** グループの遠征届設定を読む。行が無ければ既定値（必要・未開始・開催地未設定）。 */
export async function loadGroupTravelContext(entryGroupId: number): Promise<GroupTravelContext> {
  const [settings, eventRows] = await Promise.all([
    db.query.entryGroupTravelSettings.findFirst({
      where: eq(entryGroupTravelSettings.entryGroupId, entryGroupId),
    }),
    db
      .select({ id: events.id, eventDate: events.eventDate, status: events.status })
      .from(events)
      .where(eq(events.entryGroupId, entryGroupId))
      .orderBy(asc(events.eventDate), asc(events.id)),
  ])
  return {
    entryGroupId,
    units: buildTravelUnits(eventRows),
    required: settings?.required ?? true,
    routeInputStartedAt: settings?.routeInputStartedAt ?? null,
    destinationLabel: settings?.destinationLabel ?? null,
    destinationPrefecture: settings?.destinationPrefecture ?? null,
    destinationCity: settings?.destinationCity ?? null,
    destinationSource: settings?.destinationSource ?? null,
    destinationAttemptedAt: settings?.destinationAttemptedAt ?? null,
  }
}

/**
 * 経路入力が**開いている**か（R5）。
 * ＝ グループが「必要」かつ（確定名簿ありの判定が成立 or 「経路入力を開始」済み）。
 *
 * 確定名簿ありの判定は `lib/events/confirmed-roster.ts` が正典なので、呼び出し側が
 * 引いた結果を渡す（このモジュールから判定を二重に持たない）。
 */
export function isRouteInputOpen(
  ctx: Pick<GroupTravelContext, 'required' | 'routeInputStartedAt'>,
  hasConfirmedRoster: boolean,
): boolean {
  if (!ctx.required) return false
  return hasConfirmedRoster || ctx.routeInputStartedAt !== null
}

/**
 * グループが「不要」（`required=false`）なら例外を投げる（requirements AC-10・
 * Codex R1 #8）。遠征届の作成・経路入力の開始は、どちらも「不要」に切り替えた
 * 後は実行できない共通ガード。
 */
export async function requireTravelReportRequired(entryGroupId: number): Promise<void> {
  const ctx = await loadGroupTravelContext(entryGroupId)
  if (!ctx.required) {
    throw new Error('この大会は遠征届が「不要」に設定されています')
  }
}

/**
 * グループの全遠征単位について、対象者と入力済み／未入力を返す。
 *
 * ★DB 往復を単位ごとに増やさないため、グループ単位でまとめて引いてから
 * 単位へ振り分ける（S5 は全単位を一度に描く）。
 */
export async function loadTravelUnitStatuses(
  entryGroupId: number,
  units: readonly TravelUnit[],
): Promise<TravelUnitStatus[]> {
  if (units.length === 0) return []
  const eventIds = units.flatMap((u) => u.eventIds)
  if (eventIds.length === 0) return units.map((unit) => ({ unit, targets: [], pendingUserIds: [] }))

  const [attendanceRows, selection, routeRows] = await Promise.all([
    db
      .select({
        userId: users.id,
        name: users.name,
        role: users.role,
        eventId: eventAttendances.eventId,
        eventDate: events.eventDate,
      })
      .from(eventAttendances)
      .innerJoin(users, eq(users.id, eventAttendances.userId))
      .innerJoin(events, eq(events.id, eventAttendances.eventId))
      .where(
        and(
          inArray(eventAttendances.eventId, eventIds),
          eq(eventAttendances.attend, true),
          eq(users.isCircleMember, true),
          isNull(users.deactivatedAt),
        ),
      )
      .orderBy(asc(users.id), asc(events.eventDate)),
    getEffectiveSelectionStatuses(entryGroupId),
    db
      .select({ userId: travelRoutes.userId, unitStartDate: travelRoutes.unitStartDate })
      .from(travelRoutes)
      .where(eq(travelRoutes.entryGroupId, entryGroupId)),
  ])

  const savedKeys = new Set(routeRows.map((r) => `${r.unitStartDate}:${r.userId}`))
  const dateToUnit = new Map<string, string>()
  for (const unit of units) for (const date of unit.dates) dateToUnit.set(date, unit.startDate)

  // unitStartDate -> userId -> target
  const byUnit = new Map<string, Map<string, TravelTarget>>()
  for (const unit of units) byUnit.set(unit.startDate, new Map())

  for (const row of attendanceRows) {
    // 有効な確定状況が「確定」の人だけが対象者（AC-12）。名簿行も手入力も無ければ
    // 導出は「確定」なので、Map に居ない＝確定として扱う。
    const status = selection.get(row.userId) ?? 'confirmed'
    if (status !== 'confirmed') continue
    const unitKey = dateToUnit.get(row.eventDate)
    if (!unitKey) continue
    const forUnit = byUnit.get(unitKey)
    if (!forUnit) continue
    const existing = forUnit.get(row.userId)
    if (existing) {
      if (!existing.attendanceDates.includes(row.eventDate)) {
        existing.attendanceDates.push(row.eventDate)
      }
      continue
    }
    forUnit.set(row.userId, {
      userId: row.userId,
      name: row.name,
      isGuest: row.role === 'guest',
      attendanceDates: [row.eventDate],
      entered: savedKeys.has(`${unitKey}:${row.userId}`),
    })
  }

  return units.map((unit) => {
    const targets = [...(byUnit.get(unit.startDate)?.values() ?? [])]
      .map((t) => ({ ...t, attendanceDates: [...t.attendanceDates].sort() }))
      .sort((a, b) => a.userId.localeCompare(b.userId))
    return {
      unit,
      targets,
      pendingUserIds: targets.filter((t) => !t.entered).map((t) => t.userId),
    }
  })
}

/** 1つの単位ぶんだけ引く（S8・S7 の描画用）。 */
export async function loadTravelUnitStatus(
  entryGroupId: number,
  units: readonly TravelUnit[],
  unitStartDate: string,
): Promise<TravelUnitStatus | null> {
  const unit = units.find((u) => u.startDate === unitStartDate)
  if (!unit) return null
  const all = await loadTravelUnitStatuses(entryGroupId, [unit])
  return all[0] ?? null
}
