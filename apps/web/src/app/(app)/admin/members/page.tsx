import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { formatLinkedAt, formatLinkMethod } from './_line-link-format'

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E'] as const

async function updateMemberGrade(formData: FormData) {
  'use server'
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    throw new Error('Unauthorized')
  }

  const userId = formData.get('userId')
  const gradeRaw = formData.get('grade')
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('userId が不正です')
  }
  // Match updateMemberProfile: reject unknown grade values rather than
  // silently coercing to null. Empty string is the explicit "未設定" choice.
  let grade: Grade | null
  if (typeof gradeRaw !== 'string' || gradeRaw === '') {
    grade = null
  } else if ((GRADES as readonly string[]).includes(gradeRaw)) {
    grade = gradeRaw as Grade
  } else {
    throw new Error('grade が不正です')
  }

  await db
    .update(users)
    .set({ grade, updatedAt: new Date() })
    .where(eq(users.id, userId))

  revalidatePath('/admin/members')
}

export default async function MembersPage() {
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const memberList = await db.query.users.findMany({
    columns: {
      id: true,
      name: true,
      role: true,
      grade: true,
      isInvited: true,
      createdAt: true,
      deactivatedAt: true,
      lineUserId: true,
      lineLinkedAt: true,
      lineLinkedMethod: true,
    },
    orderBy: (users, { asc }) => [asc(users.createdAt)],
  })

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">会員管理</h2>
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">名前</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ロール</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">級</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">招待状態</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">登録日</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">LINE 紐付け日時</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">方法</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {memberList.map((member) => {
              const deactivated = member.deactivatedAt != null
              const rowClass = deactivated
                ? 'text-gray-400'
                : 'text-gray-900'
              return (
                <tr key={member.id} className={rowClass}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {member.name ?? '未設定'}
                    {deactivated && (
                      <span className="ml-2 inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                        退会
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">{member.role}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <form action={updateMemberGrade} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={member.id} />
                      <select
                        name="grade"
                        defaultValue={member.grade ?? ''}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                        aria-label={`${member.name ?? member.id} の級`}
                      >
                        <option value="">未設定</option>
                        {GRADES.map((g) => (
                          <option key={g} value={g}>{g}級</option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md bg-gray-100 px-3 py-1 text-xs hover:bg-gray-200"
                      >
                        保存
                      </button>
                    </form>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {member.isInvited ? '招待済み' : '未招待'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {member.createdAt.toLocaleDateString('ja-JP')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatLinkedAt(member.lineLinkedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatLinkMethod(member.lineLinkedMethod)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <Link
                      href={`/admin/members/${member.id}/edit`}
                      className="text-brand hover:underline"
                    >
                      編集
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
