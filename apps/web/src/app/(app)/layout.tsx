import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { MobileShell } from '@/components/layout/mobile-shell'
import { buildRolePreviewSelection, roleViewLabel } from '@/lib/role-preview'
import { isGuestRole } from '@/lib/guest-access'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const role = session.user?.role
  const isAdmin = role === 'admin' || role === 'vice_admin'
  // guest-role: ボトムナビを「イベント」「設定」の2タブへ絞る（AC-8）。
  const isGuest = isGuestRole(role)

  // role-preview-switch: `ROLE_PREVIEW_USER_IDS` は関数内で読む（モジュール
  // トップで読むとビルド時にインライン化され、本番で再起動しても値が
  // 反映されなくなる）。
  const realRole = session.user?.realRole ?? session.user?.role
  const rolePreview = buildRolePreviewSelection(
    session.user?.id,
    realRole,
    session.user?.role,
    process.env.ROLE_PREVIEW_USER_IDS,
  )
  // nav-settings-hub: プレビュー中だけ「設定」タブにバッジを出す。上部バーの
  // ワードマーク横に出していたバッジの移設先。タブ幅 62.5px（管理者 6 タブ）に
  // 収める必要があるので、`roleViewLabel`（管理者 / 副管理者 / 一般会員）の
  // 短い方を使う。
  const previewRoleLabel =
    rolePreview && rolePreview.current !== rolePreview.real
      ? roleViewLabel(rolePreview.current)
      : null

  return (
    <MobileShell
      isAdmin={isAdmin}
      previewRoleLabel={previewRoleLabel}
      isGuest={isGuest}
    >
      {children}
    </MobileShell>
  )
}
