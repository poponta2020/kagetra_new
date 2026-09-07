import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { events, users } from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import { loadTravelRoute } from '@/lib/travel-report/routes-store'
import {
  isRouteInputOpen,
  loadGroupTravelContext,
  loadTravelUnitStatus,
} from '@/lib/travel-report/targets'
import { findUnitContainingEvent } from '@/lib/travel-report/units'
import { RouteForm } from './RouteForm'

/**
 * travel-report S8: `/events/[id]/travel-route` — 1つの遠征単位について
 * 本人（代理入力なら対象者）の経路を入力する画面（requirements R5・R6）。
 *
 * `id` は「単位の代表 eventId」（S7・S9・S5 の各導線が渡す `unit.eventIds[0]`
 * 相当）でよい——`findUnitContainingEvent` でこの日が属する単位を都度
 * 導出するので、単位内のどの日の id を渡されても同じ画面になる。
 *
 * ★このページは「ボタンを出さない画面には直リンクを通さない」を徹底する
 * （R5・AC-11）。経路入力が閉じている／対象者でない／代理入力の権限が
 * 無いときは、理由を出し分けず一律 `notFound()`（404 相当）にする。
 * `actions.ts`（`saveTravelRouteAction`）はこのページの判定を一切信頼せず
 * 独立に再検証する（fail-closed）。
 */
export default async function TravelRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ user?: string }>
}) {
  const { id } = await params
  const { user: userParam } = await searchParams

  const eventId = Number(id)
  if (!Number.isInteger(eventId) || eventId <= 0) notFound()

  const session = await auth()
  if (!session?.user?.id) notFound()

  const eventRow = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true, title: true, entryGroupId: true },
  })
  if (!eventRow) notFound()

  const ctx = await loadGroupTravelContext(eventRow.entryGroupId)
  const unit = findUnitContainingEvent(ctx.units, eventId)
  if (!unit) notFound()

  const rosterState = await loadConfirmedRosterState(eventRow.entryGroupId)
  if (!isRouteInputOpen(ctx, rosterState.settled)) notFound()

  const status = await loadTravelUnitStatus(eventRow.entryGroupId, ctx.units, unit.startDate)
  if (!status) notFound()

  const requestedUserId = userParam?.trim()
  const targetUserId =
    requestedUserId && requestedUserId.length > 0 ? requestedUserId : session.user.id
  const isProxy = targetUserId !== session.user.id
  if (isProxy) {
    const canProxy = await isTravelReportSubmitter(session)
    if (!canProxy) notFound()
  }

  const target = status.targets.find((t) => t.userId === targetUserId)
  if (!target) notFound()

  const [targetUser, savedRoute] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, targetUserId),
      columns: {
        id: true,
        name: true,
        grade: true,
        facultyKind: true,
        faculty: true,
        schoolYear: true,
        phone: true,
      },
    }),
    loadTravelRoute(eventRow.entryGroupId, unit.startDate, targetUserId),
  ])
  if (!targetUser) notFound()

  return (
    <RouteForm
      eventId={eventRow.id}
      entryGroupId={eventRow.entryGroupId}
      eventTitle={eventRow.title}
      unit={{ startDate: unit.startDate, endDate: unit.endDate, dates: unit.dates }}
      targetUserId={targetUserId}
      targetName={targetUser.name ?? '（名前未設定）'}
      isProxy={isProxy}
      attendanceDates={target.attendanceDates}
      attendanceGrade={targetUser.grade}
      destinationLabel={ctx.destinationLabel}
      saved={
        savedRoute
          ? {
              departureKind: savedRoute.departureKind,
              departurePlace: savedRoute.departurePlace,
              returnKind: savedRoute.returnKind,
              returnPlace: savedRoute.returnPlace,
              legs: savedRoute.legs,
              savedAtIso: savedRoute.savedAt.toISOString(),
            }
          : null
      }
      profile={{
        facultyKind: targetUser.facultyKind,
        faculty: targetUser.faculty,
        schoolYear: targetUser.schoolYear,
        phone: targetUser.phone,
      }}
    />
  )
}
