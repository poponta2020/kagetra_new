import { redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { claimMemberIdentity } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  unavailable:
    '選択された会員は既に別の方に紐付けられているか、招待状態が変わっています。一覧を再確認してください。',
  duplicate:
    'この LINE アカウントは既に別の会員に紐付いています。管理者にご連絡ください。',
  invalid_input: '選択内容が無効です。もう一度お試しください。',
}

export default async function SelfIdentifyPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const session = await auth()

  // LINE login を経由していない状態では認証画面へ。
  if (!session?.user?.lineUserId) redirect('/auth/signin')

  // 既に紐付け済み (middleware が通常ここに来させないが、直 URL 等の保険)
  if (session.user.id) redirect('/')

  const candidates = await db.query.users.findMany({
    where: and(
      isNull(users.lineUserId),
      eq(users.isInvited, true),
      isNull(users.deactivatedAt),
    ),
    columns: { id: true, name: true, grade: true, affiliation: true },
    orderBy: asc(users.name),
  })

  const resolved = (await searchParams) ?? {}
  const errorCode = resolved.error
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? '処理に失敗しました。')
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-6 shadow-lg">
        <div>
          <h1 className="text-xl font-bold">あなたは誰ですか？</h1>
          <p className="mt-2 text-sm text-gray-600">
            会員一覧から、ご自身のお名前を選んでください。一度選ぶと、この
            LINE アカウントと紐付きます。
          </p>
        </div>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            選択可能な会員がいません。管理者にご連絡ください。
          </p>
        ) : (
          <form action={claimMemberIdentity} className="space-y-4">
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <input
                      type="radio"
                      name="userId"
                      value={c.id}
                      required
                      className="h-4 w-4"
                    />
                    <span className="text-sm text-gray-900">
                      {c.name ?? '(名前未設定)'}
                      {c.grade ? ` (${c.grade}級)` : ''}
                      {c.affiliation ? ` / ${c.affiliation}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="submit"
              className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand/90"
            >
              このメンバーとして続ける
            </button>
          </form>
        )}

        <p className="text-xs text-gray-500">
          一覧にお名前がない場合は管理者にご連絡ください。
        </p>
      </div>
    </div>
  )
}
