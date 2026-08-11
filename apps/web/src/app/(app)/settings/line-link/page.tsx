import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { startLineLink } from './actions'
import { isGuestRole } from '@/lib/guest-access'

const ERROR_MESSAGES: Record<string, string> = {
  missing_env: 'LINE Login の設定が未完了です。管理者にお問い合わせください。',
  state_mismatch: 'セッションの有効期限が切れました。もう一度お試しください。',
  denied: 'LINE アカウント切替がキャンセルされました。',
  conflict: 'この LINE アカウントは既に別の会員に連携されています。',
  oauth_failed: 'LINE との通信に失敗しました。時間を置いて再度お試しください。',
}

function maskLineUserId(id: string): string {
  // Keep the last 6 characters, mask the rest. Format: U****xxxxxx.
  // The full ID is never user-facing, but this mask helps admins confirm
  // which LINE account is bound without copying the whole opaque ID.
  if (id.length <= 6) return id
  return `${id.slice(0, 1)}${'*'.repeat(4)}${id.slice(-6)}`
}

export default async function LineLinkPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')
  // guest-role: ゲストは会員向け画面に入れない（許可リスト。middleware の
  // 早期ゲートに加えた Node 側の実防御 — Edge の JWT role は降格直後 stale
  // になりうる）。requirements R2 / AC-10
  if (isGuestRole(session.user?.role)) redirect('/403')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, name: true, lineUserId: true },
  })
  if (!user) redirect('/auth/signin')
  // Safety net: middleware should never send an unlinked user here,
  // but if it ever does, route them back to the primary claim flow.
  if (!user.lineUserId) redirect('/self-identify')

  const resolvedParams = (await searchParams) ?? {}
  const errorCode = resolvedParams.error
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? '処理に失敗しました。'
    : null

  // nav-settings-hub: `(app)` グループへ移設したため、シェル（ボトムナビ）の
  // 内側に収まる通常ページのレイアウトにする。以前はシェル外の孤児ページで、
  // 中央寄せカード＋「ダッシュボードへ戻る」だけが脱出口だった。
  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">
            LINE アカウント切替
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            通知を受け取る LINE アカウントを変更できます。機種変更などで
            LINE アカウントが変わった場合にご利用ください。
          </p>
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger-fg">
            {errorMessage}
          </p>
        )}

        <div className="space-y-1 rounded-md bg-surface-alt p-4 text-sm">
          <p className="text-neutral-fg">現在連携中の LINE アカウント</p>
          <p className="font-mono text-ink">{maskLineUserId(user.lineUserId)}</p>
        </div>

        {/* nav-settings-hub: 戻る導線はボトムナビ（設定タブ）が担うので、
            「ダッシュボードへ戻る」リンクは置かない。 */}
        <form action={startLineLink}>
          <button
            type="submit"
            className="rounded-md bg-line px-4 py-2 text-sm font-semibold text-white hover:bg-line-hover"
          >
            別の LINE に切り替える
          </button>
        </form>
      </div>
    </div>
  )
}
