import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { scheduleItems } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'

export default async function EditSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const idNum = Number(id)
  if (!Number.isInteger(idNum) || idNum <= 0) notFound()
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  const item = await db.query.scheduleItems.findFirst({
    where: eq(scheduleItems.id, idNum),
  })

  if (!item) notFound()

  const itemId = item.id

  async function updateScheduleItem(formData: FormData) {
    'use server'
    const session = await auth()
    if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
      throw new Error('Unauthorized')
    }
    await db.update(scheduleItems).set({
      date: formData.get('date') as string,
      name: formData.get('name') as string,
      kind: (formData.get('kind') as 'practice' | 'meeting' | 'social' | 'other') || 'other',
      startTime: (formData.get('startTime') as string) || null,
      endTime: (formData.get('endTime') as string) || null,
      location: (formData.get('location') as string) || null,
      description: (formData.get('description') as string) || null,
      updatedAt: new Date(),
    }).where(eq(scheduleItems.id, itemId))

    redirect(`/schedule/${itemId}`)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">スケジュール編集</h2>
      <form action={updateScheduleItem} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            日付 <span className="text-red-500">*</span>
          </label>
          <input
            name="date"
            type="date"
            required
            defaultValue={item.date}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            名前 <span className="text-red-500">*</span>
          </label>
          <input
            name="name"
            type="text"
            required
            defaultValue={item.name}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">種別</label>
          <select
            name="kind"
            defaultValue={item.kind}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="practice">練習</option>
            <option value="meeting">会議</option>
            <option value="social">懇親会</option>
            <option value="other">その他</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">開始時間</label>
            <input
              name="startTime"
              type="time"
              defaultValue={item.startTime ?? ''}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">終了時間</label>
            <input
              name="endTime"
              type="time"
              defaultValue={item.endTime ?? ''}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">場所</label>
          <input
            name="location"
            type="text"
            defaultValue={item.location ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">説明</label>
          <textarea
            name="description"
            rows={3}
            defaultValue={item.description ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:opacity-90"
          >
            更新
          </button>
          <Link href={`/schedule/${item.id}`} className="rounded-md bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200">
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  )
}
