import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { loadEntryFormContext } from './actions'
import { EntryFormWizard } from './EntryFormWizard'

/**
 * /admin/entry-form/[groupId] — entry-form-autofill タスク7: 申込書作成プレビュー（S2）。
 * requirements §3.2.1〜§3.2.7・design-spec（design_source: claude-design）。
 *
 * 権限は admin / vice_admin のみ（AC-2）。`loadEntryFormContext` 自身も
 * `requireAdminSession()` で二重にガードしているが、未認可ユーザーに
 * ウィザードの空 shell すら見せないようここでも判定する。
 */
export const dynamic = 'force-dynamic'

export default async function EntryFormPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const { groupId } = await params
  // 動的セグメントは10進整数のみを正規URLとする（`1.0`/`1e3` 等は404）。
  if (!/^\d+$/.test(groupId)) notFound()

  // loadEntryFormContext は存在しない groupId を「見つかりません」の Error で
  // 投げる契約（actions.ts）。それだけを 404 に正規化し、他の失敗（DB 障害など）は
  // そのまま投げる — 全部を 404 に丸めると障害が「そんなグループは無い」に化けて
  // 原因調査ができなくなる。
  let context: Awaited<ReturnType<typeof loadEntryFormContext>>
  try {
    context = await loadEntryFormContext(Number(groupId))
  } catch (error) {
    if (error instanceof Error && error.message === '申込グループが見つかりません') {
      notFound()
    }
    throw error
  }

  return <EntryFormWizard context={context} currentUserName={session.user?.name ?? null} />
}
