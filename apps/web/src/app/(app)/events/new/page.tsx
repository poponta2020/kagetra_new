import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'

export default async function NewEventPage() {
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  async function createEvent(formData: FormData) {
    'use server'
    const session = await auth()
    if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
      throw new Error('Unauthorized')
    }

    const result = await db.insert(events).values({
      title: formData.get('title') as string,
      description: (formData.get('description') as string) || undefined,
      eventDate: formData.get('eventDate') as string,
      startTime: (formData.get('startTime') as string) || undefined,
      endTime: (formData.get('endTime') as string) || undefined,
      location: (formData.get('location') as string) || undefined,
      capacity: formData.get('capacity') ? Number(formData.get('capacity')) : undefined,
      status: (formData.get('status') as 'draft' | 'published') || 'draft',
      createdBy: session.user.id,
    }).returning()

    const created = result[0]!
    redirect(`/events/${created.id}`)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">イベント作成</h2>
      <form action={createEvent} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            タイトル <span className="text-red-500">*</span>
          </label>
          <input
            name="title"
            type="text"
            required
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
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">開始時間</label>
            <input
              name="startTime"
              type="time"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">終了時間</label>
            <input
              name="endTime"
              type="time"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">場所</label>
          <input
            name="location"
            type="text"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">定員</label>
          <input
            name="capacity"
            type="number"
            min="1"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">説明</label>
          <textarea
            name="description"
            rows={3}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">ステータス</label>
          <select
            name="status"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="draft">下書き</option>
            <option value="published">公開</option>
          </select>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:opacity-90"
          >
            作成
          </button>
          <Link href="/events" className="rounded-md bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200">
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  )
}
