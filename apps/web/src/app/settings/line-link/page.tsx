import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { startLineLink } from './actions'

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow-lg">
        <div>
          <h1 className="text-xl font-bold">LINE アカウント切替</h1>
          <p className="mt-2 text-sm text-gray-600">
            通知を受け取る LINE アカウントを変更できます。機種変更などで
            LINE アカウントが変わった場合にご利用ください。
          </p>
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        <div className="space-y-1 rounded-md bg-gray-50 p-4 text-sm">
          <p className="text-gray-500">現在連携中の LINE アカウント</p>
          <p className="font-mono text-gray-900">{maskLineUserId(user.lineUserId)}</p>
        </div>

        <div className="flex gap-3">
          <Link
            href="/"
            className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
          >
            ダッシュボードへ戻る
          </Link>
          <form action={startLineLink}>
            <button
              type="submit"
              className="rounded-md bg-[#06c755] px-4 py-2 text-sm font-semibold text-white hover:bg-[#05a648]"
            >
              別の LINE に切り替える
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
