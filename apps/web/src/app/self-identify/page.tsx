import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { listRosterCandidates } from '@/lib/roster-claim'
import { RosterClaimForm } from '@/components/register/RosterClaimForm'
import { claimMemberIdentity } from './actions'

export default async function SelfIdentifyPage() {
  const session = await auth()

  // LINE login を経由していない状態では認証画面へ。
  if (!session?.user?.lineUserId) redirect('/auth/signin')

  // 既に紐付け済み (middleware が通常ここに来させないが、直 URL 等の保険)
  if (session.user.id) redirect('/')

  // 表示は氏名（と電話・生年月日が未入力かどうかの印）のみに限定する
  // （未紐付け LINE user に対して級/所属等の PII を開示しない）。
  const candidates = await listRosterCandidates()

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

        {candidates.length === 0 ? (
          <p className="rounded-md bg-warn-bg p-3 text-sm text-warn-fg">
            選択可能な会員がいません。管理者にご連絡ください。
          </p>
        ) : (
          <RosterClaimForm
            action={claimMemberIdentity}
            candidates={candidates}
            submitLabel="このメンバーとして続ける"
          />
        )}

        <p className="text-xs text-ink-meta">
          一覧にお名前がない場合は管理者にご連絡ください。
        </p>
      </div>
    </div>
  )
}
