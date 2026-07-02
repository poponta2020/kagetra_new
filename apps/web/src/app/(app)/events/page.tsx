import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances, users } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { auth } from '@/auth'
import { surname } from '@/lib/surname'
import { EventListClient } from './EventListClient'
import {
  CHIP_LIMIT,
  isGradeEligible,
  type EventListItem,
} from './event-list-utils'

// Btn primary mirrored as a Link className since wrapping <Link> in <Btn>
// would nest it inside a <button>.
const NEW_LINK_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors h-8 px-3 text-xs bg-brand text-white hover:bg-brand-hover'

export default async function EventsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'vice_admin'

  // JST today; events.eventDate is YYYY-MM-DD so lexicographic compare is correct.
  // Past events are surfaced on /events-archive — listing them here too would double-list.
  const todayStr = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })

  // Fetch event list first so the attendance join can be scoped to the visible
  // IDs — otherwise we'd scan every row in event_attendances, including rows for
  // archived events rendered on /events-archive. id is a stable secondary sort.
  const eventList = await db.query.events.findMany({
    where: gte(events.eventDate, todayStr),
    orderBy: [asc(events.eventDate), asc(events.id)],
  })
  const visibleEventIds = eventList.map((e) => e.id)

  // ⑧ 参加者名: attend=true を users 結合で表示中イベントぶん 1 クエリ取得（N+1 回避）。
  // 集計セマンティクスは現行と同じ attend=true 件数（詳細画面の eligible 絞り込みとは別）。
  const participantRows =
    visibleEventIds.length === 0
      ? []
      : await db
          .select({
            eventId: eventAttendances.eventId,
            name: users.name,
            grade: users.grade,
          })
          .from(eventAttendances)
          .innerJoin(users, eq(users.id, eventAttendances.userId))
          .where(
            and(
              inArray(eventAttendances.eventId, visibleEventIds),
              eq(eventAttendances.attend, true),
            ),
          )

  // イベント別にまとめ、級昇順（未設定は末尾）で並べる（詳細画面の参加者表示に合わせる）。
  const participantsByEvent = new Map<
    number,
    Array<{ name: string | null; grade: Grade | null }>
  >()
  for (const row of participantRows) {
    const list = participantsByEvent.get(row.eventId)
    if (list) list.push(row)
    else participantsByEvent.set(row.eventId, [row])
  }
  for (const list of participantsByEvent.values()) {
    list.sort((a, b) => (a.grade ?? 'Z').localeCompare(b.grade ?? 'Z'))
  }

  // ⑦ 申込可能判定は「自分の級」で行う（管理者バイパスなし）。級のみ取得。
  let myGrade: Grade | null = null
  if (session?.user.id) {
    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { grade: true },
    })
    myGrade = me?.grade ?? null
  }

  // クライアントへ渡す最小データ。location/official/eligibleGrades/grade はカードに
  // 渡さず、①⑤は表示から落とし、⑦は canApply に畳む。
  const items: EventListItem[] = eventList.map((e) => {
    const parts = participantsByEvent.get(e.id) ?? []
    return {
      id: e.id,
      title: e.title,
      eventDate: e.eventDate,
      internalDeadline: e.internalDeadline,
      status: e.status,
      canApply: isGradeEligible(e.eligibleGrades, myGrade),
      attendCount: parts.length,
      chipSurnames: parts.slice(0, CHIP_LIMIT).map((p) => surname(p.name)),
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">大会申込</h1>
        <div className="flex items-center gap-3">
          <Link href="/events-archive" className="text-sm text-brand">
            過去のイベント →
          </Link>
          {isAdmin && (
            <Link href="/events/new" className={NEW_LINK_CLASS}>
              新規作成
            </Link>
          )}
        </div>
      </div>
      <EventListClient items={items} todayStr={todayStr} />
    </div>
  )
}
