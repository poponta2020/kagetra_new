import 'server-only'
import { and, eq, gte, inArray, ne } from 'drizzle-orm'
import { eventAttendances, events } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { deriveEntryGroupName } from '@/lib/entry-groups'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import { isRouteInputOpen, loadGroupTravelContext, loadTravelUnitStatuses } from './targets'

/**
 * travel-report: S9 ホームの「遠征経路 未入力」導線（requirements S9・AC-17）。
 *
 * 集める条件:
 * - その人が**対象者**である遠征単位（`loadTravelUnitStatuses` の `targets` に居る）
 * - **未入力**（`entered === false`）
 * - 単位の最終日（`unit.endDate`）を**過ぎていない**（`endDate >= today`）
 * - グループが「必要」かつ経路入力が**開いている**（`isRouteInputOpen`）
 *
 * ★全グループを総なめしない。まず「今日以降に開催日があり、その人が出欠
 * 『参加』のイベント」で候補グループを絞ってから、そのグループだけ遠征単位・
 * 対象者判定を組み立てる（`loadGroupTravelContext` / `loadTravelUnitStatuses` は
 * グループ単位で DB を往復するため、母集団を広げると N+1 になる）。
 *
 * サークル非所属・キャンセル待ち・不参加の判定は `loadTravelUnitStatuses`
 * （`targets.ts`）が対象者から除外するので、ここでは`targets` に居るかどうかだけを見る。
 */

export interface TravelRouteAlert {
  /** 遠征単位のキー（ブロック初日＝`travel_routes.unit_start_date` と同じ値）。React key に使う。 */
  unitKey: string
  entryGroupId: number
  /** 大会名（グループ内イベントのタイトルから導出。`events/[id]` の groupName と同じ規律）。 */
  tournamentName: string
  /** 単位に含まれる開催日（`YYYY-MM-DD`・昇順）。表示側が「M/D・M/D」等に整形する。 */
  unitDates: string[]
  /** リンク先 `/events/{routeEventId}/travel-route` の eventId（単位の先頭イベント）。 */
  routeEventId: number
}

export async function loadTravelRouteAlerts(
  userId: string,
  today: string,
): Promise<TravelRouteAlert[]> {
  // Step 1: 候補グループの絞り込み。今日以降に開催日があり、この人が出欠「参加」の
  // イベントが属するグループだけを見る（cancelled は候補から除く）。
  const candidateRows = await db
    .select({ entryGroupId: events.entryGroupId })
    .from(eventAttendances)
    .innerJoin(events, eq(events.id, eventAttendances.eventId))
    .where(
      and(
        eq(eventAttendances.userId, userId),
        eq(eventAttendances.attend, true),
        gte(events.eventDate, today),
        ne(events.status, 'cancelled'),
      ),
    )
  const entryGroupIds = [...new Set(candidateRows.map((r) => r.entryGroupId))]
  if (entryGroupIds.length === 0) return []

  const alerts: TravelRouteAlert[] = []

  for (const entryGroupId of entryGroupIds) {
    const ctx = await loadGroupTravelContext(entryGroupId)
    if (!ctx.required) continue

    const { settled: hasConfirmedRoster } = await loadConfirmedRosterState(entryGroupId)
    if (!isRouteInputOpen(ctx, hasConfirmedRoster)) continue

    // 最終日を過ぎた単位はそもそも組み立てない。
    const openUnits = ctx.units.filter((u) => u.endDate >= today)
    if (openUnits.length === 0) continue

    const statuses = await loadTravelUnitStatuses(entryGroupId, openUnits)

    const targetStatuses = statuses.filter((s) =>
      s.targets.some((t) => t.userId === userId && !t.entered),
    )
    if (targetStatuses.length === 0) continue

    // 大会名: グループ内の全イベント（cancelled 除く。ctx.units が既に除外済み）の
    // タイトルから導出する（`events/[id]` の groupName と同じ規律。イベントが1件なら
    // そのタイトルをそのまま使う）。
    const allEventIds = ctx.units.flatMap((u) => u.eventIds)
    const titleRows = allEventIds.length
      ? await db
          .select({ id: events.id, title: events.title })
          .from(events)
          .where(inArray(events.id, allEventIds))
      : []
    const titleById = new Map(titleRows.map((r) => [r.id, r.title]))
    const titles = allEventIds
      .map((id) => titleById.get(id))
      .filter((t): t is string => t != null)
    const tournamentName =
      titles.length > 1 ? (deriveEntryGroupName(titles) ?? titles[0]!) : (titles[0] ?? '')

    for (const { unit, targets } of targetStatuses) {
      const target = targets.find((t) => t.userId === userId)
      if (!target || target.entered) continue
      const routeEventId = unit.eventIds[0]
      if (routeEventId == null) continue
      alerts.push({
        unitKey: unit.startDate,
        entryGroupId,
        tournamentName,
        unitDates: unit.dates,
        routeEventId,
      })
    }
  }

  alerts.sort((a, b) => a.unitKey.localeCompare(b.unitKey) || a.entryGroupId - b.entryGroupId)
  return alerts
}
