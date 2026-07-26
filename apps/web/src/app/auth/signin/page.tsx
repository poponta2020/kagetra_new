import { signIn } from '@/auth'

const ERROR_MESSAGES: Record<string, string> = {
  deactivated: '退会済みの会員です。再入会を希望される方は管理者にご連絡ください。',
  Configuration: 'LINE Login 設定が未完了です。管理者にお問い合わせください。',
  AccessDenied: 'ログインが拒否されました。',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const resolved = (await searchParams) ?? {}
  const errorCode = resolved.error
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? 'ログインに失敗しました。')
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-surface p-8 shadow-lg">
        <div>
          <h1 className="text-xl font-bold">かげとら ログイン</h1>
          <p className="mt-2 text-sm text-ink-2">
            LINE アカウントでログインします。
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

        <form
          action={async () => {
            'use server'
            await signIn('line', { redirectTo: '/' })
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-line px-4 py-3 text-sm font-semibold text-white hover:bg-line-hover"
          >
            LINE でログイン
          </button>
        </form>
      </div>
    </div>
  )
}
