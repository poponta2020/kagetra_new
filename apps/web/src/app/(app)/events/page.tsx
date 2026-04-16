import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances } from '@kagetra/shared/schema'
import { desc, eq, count } from 'drizzle-orm'
import { auth } from '@/auth'

export default async function EventsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'vice_admin'

  const [eventList, attendCounts] = await Promise.all([
    db.query.events.findMany({
      orderBy: [desc(events.eventDate)],
    }),
    db
      .select({
        eventId: eventAttendances.eventId,
        count: count(),
      })
      .from(eventAttendances)
      .where(eq(eventAttendances.attend, true))
      .groupBy(eventAttendances.eventId),
  ])
  const attendCountMap = new Map(attendCounts.map((c) => [c.eventId, c.count]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">イベント一覧</h2>
        {isAdmin && (
          <Link
            href="/events/new"
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:opacity-90"
          >
            新規作成
          </Link>
        )}
      </div>
      <div className="space-y-3">
        {eventList.length === 0 ? (
          <p className="text-sm text-gray-500">イベントはまだありません</p>
        ) : (
          eventList.map((event) => {
            const attendCount = attendCountMap.get(event.id) ?? 0
            return (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="block rounded-lg bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{event.title}</h3>
                      {event.official && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          公認
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {event.eventDate}
                      {event.startTime && ` ${event.startTime}`}
                      {event.endTime && `〜${event.endTime}`}
                    </p>
                    {event.location && (
                      <p className="text-sm text-gray-500">{event.location}</p>
                    )}
                    <div className="mt-1 flex items-center gap-3">
                      {event.internalDeadline && (
                        <span className="text-xs text-gray-400">会内締切: {event.internalDeadline}</span>
                      )}
                      {attendCount > 0 && (
                        <span className="text-xs text-green-600">参加{attendCount}名</span>
                      )}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${
                    event.status === 'published' ? 'bg-green-100 text-green-700' :
                    event.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                    event.status === 'done' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {event.status === 'published' ? '公開' : event.status === 'cancelled' ? '中止' : event.status === 'done' ? '終了' : '下書き'}
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
