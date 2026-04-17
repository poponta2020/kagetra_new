import Link from 'next/link'
import { db } from '@/lib/db'
import { scheduleItems } from '@kagetra/shared/schema'
import { desc } from 'drizzle-orm'
import { auth } from '@/auth'

const kindLabels: Record<string, string> = {
  practice: '練習',
  meeting: '会議',
  social: '懇親会',
  other: 'その他',
}

const kindColors: Record<string, string> = {
  practice: 'bg-blue-100 text-blue-700',
  meeting: 'bg-purple-100 text-purple-700',
  social: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-600',
}

export default async function SchedulePage() {
  const session = await auth()
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'vice_admin'

  const items = await db.query.scheduleItems.findMany({
    orderBy: [desc(scheduleItems.date)],
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">スケジュール一覧</h2>
        {isAdmin && (
          <Link
            href="/schedule/new"
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:opacity-90"
          >
            新規作成
          </Link>
        )}
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">スケジュールはまだありません</p>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={`/schedule/${item.id}`}
              className="block rounded-lg bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{item.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {item.date}
                    {item.startTime && ` ${item.startTime}`}
                    {item.endTime && `〜${item.endTime}`}
                  </p>
                  {item.location && (
                    <p className="text-sm text-gray-500">{item.location}</p>
                  )}
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${kindColors[item.kind] ?? 'bg-gray-100 text-gray-600'}`}>
                  {kindLabels[item.kind] ?? 'その他'}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
