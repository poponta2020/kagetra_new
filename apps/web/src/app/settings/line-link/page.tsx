import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { startLineLink } from './actions'

export default async function LineLinkPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  // Pull latest lineUserId from DB (session token lags behind until refresh).
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, name: true, lineUserId: true },
  })
  if (!user) redirect('/login')

  const resolvedParams = (await searchParams) ?? {}
  const errorCode = resolvedParams.error
  const errorMessage = errorCode ? describeError(errorCode) : null

  const alreadyLinked = user.lineUserId != null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow-lg">
        <div>
          <h1 className="text-xl font-bold">LINE 連携</h1>
          <p className="mt-2 text-sm text-gray-600">
            通知を受け取るには LINE アカウントとの連携が必要です。
          </p>
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        {alreadyLinked ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              LINE 連携済みです。通知はこのアカウントに届きます。
            </p>
            <div className="flex gap-3">
              <Link
                href="/"
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
              >
                ダッシュボードへ
              </Link>
              <form action={startLineLink}>
                <button
                  type="submit"
                  className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
                >
                  別の LINE で再連携
                </button>
              </form>
            </div>
          </div>
        ) : (
          <form action={startLineLink}>
            <button
              type="submit"
              className="w-full rounded-md bg-[#06c755] px-4 py-3 text-sm font-semibold text-white hover:bg-[#05a648]"
            >
              LINE で連携する
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function describeError(code: string): string {
  switch (code) {
    case 'missing_env':
      return 'LINE Login の設定が未完了です。管理者にお問い合わせください。'
    case 'state_mismatch':
      return 'セッションの有効期限が切れました。もう一度お試しください。'
    case 'denied':
      return 'LINE 連携がキャンセルされました。'
    case 'conflict':
      return 'この LINE アカウントは既に別の会員に連携されています。'
    case 'oauth_failed':
      return 'LINE との通信に失敗しました。時間を置いて再度お試しください。'
    default:
      return '連携中にエラーが発生しました。'
  }
}
