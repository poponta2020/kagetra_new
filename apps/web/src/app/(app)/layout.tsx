import { auth, signOut } from '@/auth'
import { redirect } from 'next/navigation'
import { MobileShell } from '@/components/layout/mobile-shell'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const signOutAction = async () => {
    'use server'
    await signOut({ redirectTo: '/auth/signin' })
  }

  const role = session.user?.role
  const isAdmin = role === 'admin' || role === 'vice_admin'

  return (
    <MobileShell
      user={session.user?.name ? `${session.user.name}さん` : ''}
      isAdmin={isAdmin}
      signOutAction={signOutAction}
    >
      {children}
    </MobileShell>
  )
}
