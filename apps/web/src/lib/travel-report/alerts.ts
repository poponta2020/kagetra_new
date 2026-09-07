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
 * ★全グループを総なめしない。まず「本人が出欠『参加』のイベントを持つグループ」で
 * 候補グループを絞り、さらに「そのグループに今日以降の非 cancelled 開催日が
 * 存在する」ことを別条件（EXISTS 相当）で確認する（`loadGroupTravelContext` /
 * `loadTravelUnitStatuses` はグループ単位で DB を往復するため、母集団を広げると
 * N+1 になる）。
 *
 * ★本人の出場日そのものを `>= today` で絞ってはいけない（Codex R1 #5）。進行中の
 * 複数日単位（例: 昨日〜今日）で本人が単位内の**前日だけ**出場するケースがあると、
 * 本人の出場イベントの日付は today より前になり候補から漏れる。単位の最終日
 * （today）を過ぎていなければ AC-17 上はまだアラートが出るべきなので、候補の
 * 絞り込みはグループ単位（本人の出場日ではなく）で行う。
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
  // Step 1a: 本人が出欠「参加」の非 cancelled イベントを持つグループを候補にする。
  // ★本人の出場日そのものを `>= today` で絞らない（単位内の前日だけ出場するケースを
  // 落とさないため。Codex R1 #5）。
  const attendedRows = await db
    .select({ entryGroupId: events.entryGroupId })
    .from(eventAttendances)
    .innerJoin(events, eq(events.id, eventAttendances.eventId))
    .where(
      and(
        eq(eventAttendances.userId, userId),
        eq(eventAttendances.attend, true),
        ne(events.status, 'cancelled'),
      ),
    )
  const attendedGroupIds = [...new Set(attendedRows.map((r) => r.entryGroupId))]
  if (attendedGroupIds.length === 0) return []

  // Step 1b: そのうち、グループ自体に今日以降の非 cancelled 開催日が存在するもの
  // だけを候補に残す（EXISTS 相当。単位の最終日が today 以降ならまだアラート対象）。
  const futureRows = await db
    .select({ entryGroupId: events.entryGroupId })
    .from(events)
    .where(
      and(
        inArray(events.entryGroupId, attendedGroupIds),
        gte(events.eventDate, today),
        ne(events.status, 'cancelled'),
      ),
    )
  const entryGroupIds = [...new Set(futureRows.map((r) => r.entryGroupId))]
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
