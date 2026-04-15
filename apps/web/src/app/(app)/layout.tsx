import { auth, signOut } from '@/auth'
import { redirect } from 'next/navigation'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

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
                await signOut({ redirectTo: '/auth/signin' })
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
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  )
}
