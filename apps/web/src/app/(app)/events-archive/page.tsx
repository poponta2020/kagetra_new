import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances } from '@kagetra/shared/schema'
import { and, desc, eq, count, inArray, lt } from 'drizzle-orm'
import { Card, Pill, StatusPill } from '@/components/ui'

export default async function EventsArchivePage() {
  // JST today; events.eventDate is YYYY-MM-DD so lexicographic compare is correct.
  const todayStr = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })

  // Fetch event list first so the attendance aggregate can be scoped to the
  // visible IDs — otherwise we'd scan every row in event_attendances, including
  // rows for current events rendered on /events.
  const eventList = await db.query.events.findMany({
    where: lt(events.eventDate, todayStr),
    orderBy: [desc(events.eventDate)],
  })
  const visibleEventIds = eventList.map((e) => e.id)
  const attendCounts =
    visibleEventIds.length === 0
      ? []
      : await db
          .select({
            eventId: eventAttendances.eventId,
            count: count(),
          })
          .from(eventAttendances)
          .where(
            and(
              inArray(eventAttendances.eventId, visibleEventIds),
              eq(eventAttendances.attend, true),
            ),
          )
          .groupBy(eventAttendances.eventId)
  const attendCountMap = new Map(attendCounts.map((c) => [c.eventId, c.count]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">
          過去のイベント
        </h1>
        <Link href="/events" className="text-sm text-brand">
          現在のイベント →
        </Link>
      </div>
      {eventList.length === 0 ? (
        <Card>
          <div className="text-center text-ink-meta py-6">
            過去のイベントはまだありません
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
