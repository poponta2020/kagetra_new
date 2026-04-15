import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'vice_admin'

  const event = await db.query.events.findFirst({
    where: eq(events.id, Number(id)),
  })

  if (!event) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{event.title}</h2>
        {isAdmin && (
          <Link
            href={`/events/${event.id}/edit`}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200"
          >
            編集
          </Link>
        )}
      </div>
      <div className="rounded-lg bg-white p-6 shadow-sm space-y-4">
        <div>
          <dt className="text-sm text-gray-500">日付</dt>
          <dd>{event.eventDate}</dd>
        </div>
        {(event.startTime || event.endTime) && (
          <div>
            <dt className="text-sm text-gray-500">時間</dt>
            <dd>
              {event.startTime ?? ''}
              {event.endTime ? `〜${event.endTime}` : ''}
            </dd>
          </div>
        )}
        {event.location && (
          <div>
            <dt className="text-sm text-gray-500">場所</dt>
            <dd>{event.location}</dd>
          </div>
        )}
        {event.capacity && (
          <div>
            <dt className="text-sm text-gray-500">定員</dt>
            <dd>{event.capacity}名</dd>
          </div>
        )}
        {event.description && (
          <div>
            <dt className="text-sm text-gray-500">説明</dt>
            <dd className="whitespace-pre-wrap">{event.description}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm text-gray-500">ステータス</dt>
          <dd>
            <span className={`rounded-full px-2 py-1 text-xs ${
              event.status === 'published' ? 'bg-green-100 text-green-700' :
              event.status === 'cancelled' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {event.status === 'published' ? '公開' : event.status === 'cancelled' ? '中止' : '下書き'}
            </span>
          </dd>
        </div>
      </div>
      <Link href="/events" className="text-sm text-gray-500 hover:text-gray-700">
        ← イベント一覧に戻る
      </Link>
    </div>
  )
}
