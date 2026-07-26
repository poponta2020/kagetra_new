import { redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { CandidateList } from './candidate-list'

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
    // 表示は氏名のみに限定する（未紐付け LINE user に対して級/所属を開示しない）。
    columns: { id: true, name: true },
    orderBy: asc(users.name),
  })

  const resolved = (await searchParams) ?? {}
  const errorCode = resolved.error
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? '処理に失敗しました。')
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-surface p-6 shadow-lg">
        <div>
          <h1 className="text-xl font-bold">あなたは誰ですか？</h1>
          <p className="mt-2 text-sm text-ink-2">
            会員一覧から、ご自身のお名前を選んでください。一度選ぶと、この
            LINE アカウントと紐付きます。
          </p>
        </div>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md bg-danger-bg p-3 text-sm text-danger-fg"
          >
            {errorMessage}
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="rounded-md bg-warn-bg p-3 text-sm text-warn-fg">
            選択可能な会員がいません。管理者にご連絡ください。
          </p>
        ) : (
          <CandidateList candidates={candidates} />
        )}

        <p className="text-xs text-ink-meta">
          一覧にお名前がない場合は管理者にご連絡ください。
        </p>
      </div>
    </div>
  )
}
