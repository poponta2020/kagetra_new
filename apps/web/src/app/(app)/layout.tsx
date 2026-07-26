import { auth, signOut } from '@/auth'
import { redirect } from 'next/navigation'
import { MobileShell } from '@/components/layout/mobile-shell'
import { setRolePreviewAction } from './role-preview-actions'
import {
  isRolePreviewAllowed,
  previewBadgeLabel,
  selectableRoles,
} from '@/lib/role-preview'

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

  // role-preview-switch: `ROLE_PREVIEW_USER_IDS` は関数内で読む（モジュール
  // トップで読むとビルド時にインライン化され、本番で再起動しても値が
  // 反映されなくなる）。
  const realRole = session.user?.realRole ?? session.user?.role
  const previewEnabled = isRolePreviewAllowed(
    session.user?.id,
    process.env.ROLE_PREVIEW_USER_IDS,
  )
  const previewBadge = previewBadgeLabel(realRole, session.user?.role)
  const rolePreview =
    realRole && (previewEnabled || previewBadge !== null)
      ? {
          current: session.user.role,
          real: realRole,
          // ⚠️ de-list 中（許可リストから外れたがプレビュー中）は「本物の
          // ロールへ戻す」1択だけ残す（締め出し防止）。
          selectable: previewEnabled ? selectableRoles(realRole) : [realRole],
        }
      : null

  return (
    <MobileShell
      user={session.user?.name ? `${session.user.name}さん` : ''}
      isAdmin={isAdmin}
      signOutAction={signOutAction}
      rolePreview={rolePreview}
      previewBadge={previewBadge}
      setRolePreviewAction={setRolePreviewAction}
    >
      {children}
    </MobileShell>
  )
}
