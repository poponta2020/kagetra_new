import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances } from '@kagetra/shared/schema'
import { desc, eq, count } from 'drizzle-orm'
import { auth } from '@/auth'
import { Card, Pill, StatusPill } from '@/components/ui'

// Btn primary mirrored as a Link className since wrapping <Link> in <Btn>
// would nest it inside a <button>.
const NEW_LINK_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors h-8 px-3 text-xs bg-brand text-white hover:bg-brand-hover'

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">イベント一覧</h1>
        {isAdmin && (
          <Link href="/events/new" className={NEW_LINK_CLASS}>
            新規作成
          </Link>
        )}
      </div>
      {eventList.length === 0 ? (
        <Card>
          <div className="text-center text-ink-meta py-6">
            イベントはまだありません
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {eventList.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="block"
            >
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink truncate">
                        {event.title}
                      </span>
                      {event.official && (
                        <Pill tone="success" size="sm">
                          公認
                        </Pill>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-ink-meta">
                      {event.eventDate}
                      {event.startTime && ` ${event.startTime}`}
                      {event.endTime && `〜${event.endTime}`}
                    </div>
                    {event.location && (
                      <div className="mt-0.5 text-xs text-ink-meta">
                        {event.location}
                      </div>
                    )}
                    {event.internalDeadline && (
                      <div className="mt-0.5 text-xs text-ink-meta">
                        締切: {event.internalDeadline}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusPill status={event.status} size="sm" />
                    <span className="text-xs text-ink-meta">
                      参加 {attendCountMap.get(event.id) ?? 0}名
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
