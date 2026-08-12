import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { isGuestRole } from '@/lib/guest-access'

export default async function Home() {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  // guest-role: ゲストは `/dashboard` に入れない（許可リストで拒否される）
  // ので、ログイン直後の入口は `/events` に振る（requirements S3）。
  if (isGuestRole(session.user?.role)) redirect('/events')
  redirect('/dashboard')
}
