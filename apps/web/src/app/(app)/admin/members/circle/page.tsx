import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { CircleBulkEditTable } from './circle-bulk-edit-table'

/**
 * S3 一括編集画面。サークル所属・学部区分・学部等名・学年を複数人まとめて
 * 保存する（requirements S3・AC-6）。管理者・副管理者のみ（既存の会員一覧と
 * 同じガード）。
 */
export default async function CircleBulkEditPage() {
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const memberList = await db.query.users.findMany({
    columns: {
      id: true,
      name: true,
      isCircleMember: true,
      facultyKind: true,
      faculty: true,
      schoolYear: true,
    },
    orderBy: (users, { asc }) => [asc(users.createdAt)],
  })

  return (
    <div className="space-y-4 p-4">
      <div>
        <Link
          href="/admin/members"
          className="text-sm text-ink-meta hover:text-ink-2"
        >
          ← 会員一覧へ戻る
        </Link>
        <h2 className="mt-2 text-xl font-bold">サークル所属の一括編集</h2>
        <p className="mt-1 text-sm text-ink-2">
          複数人のサークル所属・学部区分・学部等名・学年をまとめて保存できます。
        </p>
      </div>

      <CircleBulkEditTable
        members={memberList.map((m) => ({
          id: m.id,
          name: m.name ?? '未設定',
          isCircleMember: m.isCircleMember,
          facultyKind: m.facultyKind ?? null,
          faculty: m.faculty ?? null,
          schoolYear: m.schoolYear ?? null,
        }))}
      />
    </div>
  )
}
