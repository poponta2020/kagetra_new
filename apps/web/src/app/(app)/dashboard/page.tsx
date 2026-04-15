import { auth } from '@/auth'

export default async function DashboardPage() {
  const session = await auth()

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">ダッシュボード</h2>
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <p>ようこそ、{session?.user?.name}さん</p>
        <p className="mt-2 text-sm text-gray-500">
          ロール: {session?.user?.role}
        </p>
      </div>
    </div>
  )
}
