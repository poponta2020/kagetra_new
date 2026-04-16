import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { scheduleItems } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'

const kindLabels: Record<string, string> = {
  practice: '練習',
  meeting: '会議',
  social: '懇親会',
  other: 'その他',
}

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const idNum = Number(id)
  if (!Number.isInteger(idNum) || idNum <= 0) notFound()
  const session = await auth()
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'vice_admin'

  const item = await db.query.scheduleItems.findFirst({
    where: eq(scheduleItems.id, idNum),
  })

  if (!item) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{item.name}</h2>
        {isAdmin && (
          <Link
            href={`/schedule/${item.id}/edit`}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200"
          >
            編集
          </Link>
        )}
      </div>
      <div className="rounded-lg bg-white p-6 shadow-sm space-y-4">
        <div>
          <dt className="text-sm text-gray-500">日付</dt>
          <dd>{item.date}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">種別</dt>
          <dd>{kindLabels[item.kind] ?? 'その他'}</dd>
        </div>
        {(item.startTime || item.endTime) && (
          <div>
            <dt className="text-sm text-gray-500">時間</dt>
            <dd>
              {item.startTime ?? ''}
              {item.endTime ? `〜${item.endTime}` : ''}
            </dd>
          </div>
        )}
        {item.location && (
          <div>
            <dt className="text-sm text-gray-500">場所</dt>
            <dd>{item.location}</dd>
          </div>
        )}
        {item.description && (
          <div>
            <dt className="text-sm text-gray-500">説明</dt>
            <dd className="whitespace-pre-wrap">{item.description}</dd>
          </div>
        )}
      </div>
      <Link href="/schedule" className="text-sm text-gray-500 hover:text-gray-700">
        ← スケジュール一覧に戻る
      </Link>
    </div>
  )
}
