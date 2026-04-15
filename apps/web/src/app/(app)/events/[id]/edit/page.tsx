import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  const event = await db.query.events.findFirst({
    where: eq(events.id, Number(id)),
  })

  if (!event) notFound()

  const eventId = event.id

  async function updateEvent(formData: FormData) {
    'use server'
    const session = await auth()
    if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
      throw new Error('Unauthorized')
    }
    await db.update(events).set({
      title: formData.get('title') as string,
      description: (formData.get('description') as string) || null,
      eventDate: formData.get('eventDate') as string,
      startTime: (formData.get('startTime') as string) || null,
      endTime: (formData.get('endTime') as string) || null,
      location: (formData.get('location') as string) || null,
      capacity: formData.get('capacity') ? Number(formData.get('capacity')) : null,
      status: formData.get('status') as 'draft' | 'published' | 'cancelled',
      updatedAt: new Date(),
    }).where(eq(events.id, eventId))

    redirect(`/events/${eventId}`)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">イベント編集</h2>
      <form action={updateEvent} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            タイトル <span className="text-red-500">*</span>
          </label>
          <input
            name="title"
            type="text"
            required
            defaultValue={event.title}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            日付 <span className="text-red-500">*</span>
          </label>
          <input
            name="eventDate"
            type="date"
            required
            defaultValue={event.eventDate}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">開始時間</label>
            <input
              name="startTime"
              type="time"
              defaultValue={event.startTime ?? ''}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">終了時間</label>
            <input
              name="endTime"
              type="time"
              defaultValue={event.endTime ?? ''}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">場所</label>
          <input
            name="location"
            type="text"
            defaultValue={event.location ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">定員</label>
          <input
            name="capacity"
            type="number"
            min="1"
            defaultValue={event.capacity ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">説明</label>
          <textarea
            name="description"
            rows={3}
            defaultValue={event.description ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">ステータス</label>
          <select
            name="status"
            defaultValue={event.status}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="draft">下書き</option>
            <option value="published">公開</option>
            <option value="cancelled">中止</option>
          </select>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:opacity-90"
          >
            更新
          </button>
          <Link href={`/events/${event.id}`} className="rounded-md bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200">
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  )
}
