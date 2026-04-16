import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances, users } from '@kagetra/shared/schema'
import { eq, inArray } from 'drizzle-orm'
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
    with: {
      eventGroup: true,
      attendances: {
        with: { user: true },
      },
    },
  })

  if (!event) notFound()

  // Get eligible users for unanswered count
  const eligibleUsers = event.eligibleGrades?.length
    ? await db.query.users.findMany({
        where: inArray(users.grade, event.eligibleGrades as ('A' | 'B' | 'C' | 'D' | 'E')[]),
      })
    : await db.query.users.findMany()

  const attendingList = event.attendances.filter(a => a.attend)
  const notAttendingList = event.attendances.filter(a => !a.attend)
  const respondedUserIds = new Set(event.attendances.map(a => a.userId))
  const unansweredUsers = eligibleUsers.filter(u => !respondedUserIds.has(u.id))

  // Check if current user can respond to attendance
  const todayStr = new Date().toISOString().slice(0, 10)
  const isBeforeDeadline = !event.internalDeadline || event.internalDeadline >= todayStr
  const myAttendance = session ? event.attendances.find(a => a.userId === session.user.id) : null

  // Fetch current user's grade from DB if logged in
  let currentUserGrade: string | null = null
  if (session?.user.id) {
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    })
    currentUserGrade = currentUser?.grade ?? null
  }

  const isEligible = !event.eligibleGrades?.length || (currentUserGrade != null && event.eligibleGrades.includes(currentUserGrade))
  const canRespond = session && isBeforeDeadline && isEligible

  async function submitAttendance(formData: FormData) {
    'use server'
    const session = await auth()
    if (!session) throw new Error('Unauthorized')

    const eventId = Number(formData.get('eventId'))
    const attend = formData.get('attend') === 'true'
    const comment = (formData.get('comment') as string) || null

    await db
      .insert(eventAttendances)
      .values({ eventId, userId: session.user.id, attend, comment })
      .onConflictDoUpdate({
        target: [eventAttendances.eventId, eventAttendances.userId],
        set: { attend, comment, updatedAt: new Date() },
      })

    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/events/${eventId}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{event.title}</h2>
          <span className={`rounded-full px-2 py-1 text-xs ${
            event.official ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {event.official ? '公認' : '非公認'}
          </span>
        </div>
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
        {event.formalName && (
          <div>
            <dt className="text-sm text-gray-500">正式名称</dt>
            <dd>{event.formalName}</dd>
          </div>
        )}
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
        {event.eventGroup && (
          <div>
            <dt className="text-sm text-gray-500">大会グループ</dt>
            <dd>{event.eventGroup.name}</dd>
          </div>
        )}
        {event.entryDeadline && (
          <div>
            <dt className="text-sm text-gray-500">大会申込締切</dt>
            <dd>{event.entryDeadline}</dd>
          </div>
        )}
        {event.internalDeadline && (
          <div>
            <dt className="text-sm text-gray-500">会内締切</dt>
            <dd>{event.internalDeadline}</dd>
          </div>
        )}
        {event.eligibleGrades && event.eligibleGrades.length > 0 && (
          <div>
            <dt className="text-sm text-gray-500">参加可能な級</dt>
            <dd className="flex gap-1 mt-1">
              {event.eligibleGrades.map((g) => (
                <span key={g} className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                  {g}級
                </span>
              ))}
            </dd>
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
              event.status === 'done' ? 'bg-blue-100 text-blue-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {event.status === 'published' ? '公開' : event.status === 'cancelled' ? '中止' : event.status === 'done' ? '終了' : '下書き'}
            </span>
          </dd>
        </div>
      </div>

      {/* Attendance section */}
      <div className="rounded-lg bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-lg font-bold">出欠状況</h3>

        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium text-green-700">参加 ({attendingList.length}名)</span>
            {attendingList.length > 0 && (
              <p className="mt-1 text-sm text-gray-700">
                {attendingList.map(a => a.user.name ?? '名前未設定').join(', ')}
              </p>
            )}
          </div>
          <div>
            <span className="text-sm font-medium text-red-700">不参加 ({notAttendingList.length}名)</span>
            {notAttendingList.length > 0 && (
              <p className="mt-1 text-sm text-gray-700">
                {notAttendingList.map(a => a.user.name ?? '名前未設定').join(', ')}
              </p>
            )}
          </div>
          <div>
            <span className="text-sm font-medium text-gray-500">未回答 ({unansweredUsers.length}名)</span>
            {unansweredUsers.length > 0 && (
              <p className="mt-1 text-sm text-gray-700">
                {unansweredUsers.map(u => u.name ?? '名前未設定').join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Attendance form for current user */}
        {session && (
          <div className="border-t pt-4">
            {canRespond ? (
              <form action={submitAttendance} className="space-y-3">
                <input type="hidden" name="eventId" value={event.id} />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">コメント（任意）</label>
                  <textarea
                    name="comment"
                    defaultValue={myAttendance?.comment ?? ''}
                    placeholder="コメント（任意）"
                    rows={2}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    name="attend"
                    value="true"
                    className={`rounded-md px-4 py-2 text-sm font-medium ${
                      myAttendance?.attend === true
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    参加
                  </button>
                  <button
                    type="submit"
                    name="attend"
                    value="false"
                    className={`rounded-md px-4 py-2 text-sm font-medium ${
                      myAttendance?.attend === false
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    不参加
                  </button>
                </div>
              </form>
            ) : !isBeforeDeadline ? (
              <p className="text-sm text-gray-500">締切済み</p>
            ) : !isEligible ? (
              <p className="text-sm text-gray-500">対象外の級です</p>
            ) : null}
          </div>
        )}
      </div>

      <Link href="/events" className="text-sm text-gray-500 hover:text-gray-700">
        ← イベント一覧に戻る
      </Link>
    </div>
  )
}
