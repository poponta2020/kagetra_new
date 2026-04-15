import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'

export default async function MembersPage() {
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const memberList = await db.query.users.findMany({
    columns: { id: true, name: true, role: true, isInvited: true, createdAt: true },
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">招待状態</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">登録日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {memberList.map((member) => (
              <tr key={member.id}>
                <td className="whitespace-nowrap px-4 py-3 text-sm">{member.name ?? '未設定'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">{member.role}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {member.isInvited ? '招待済み' : '未招待'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {member.createdAt.toLocaleDateString('ja-JP')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
