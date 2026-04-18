import { auth, signOut } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const isAdmin = session.user?.role === 'admin' || session.user?.role === 'vice_admin'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold text-brand">かげとら</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{session.user?.name}</span>
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/login' })
              }}
            >
              <button
                type="submit"
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto max-w-5xl border-t border-gray-100 px-4">
          <ul className="flex gap-6 text-sm">
            <li>
              <Link href="/dashboard" className="inline-block py-2 text-gray-600 hover:text-brand">
                ダッシュボード
              </Link>
            </li>
            <li>
              <Link href="/events" className="inline-block py-2 text-gray-600 hover:text-brand">
                イベント
              </Link>
            </li>
            <li>
              <Link href="/schedule" className="inline-block py-2 text-gray-600 hover:text-brand">
                スケジュール
              </Link>
            </li>
            {isAdmin && (
              <li>
                <Link href="/admin/members" className="inline-block py-2 text-gray-600 hover:text-brand">
                  会員管理
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  )
}
