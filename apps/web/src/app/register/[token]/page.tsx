import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth, signIn } from '@/auth'
import { db } from '@/lib/db'
import { registrationInvites } from '@kagetra/shared/schema'
import { isRegistrationInviteUsable } from '@/lib/registration-invite'
import { RegisterForm } from './register-form'

/**
 * Invite-link self-registration page. Rendered outside the (app) shell (no
 * mobile nav), like /auth/signin and /self-identify. Middleware lets the
 * unauthenticated and authenticated-but-unbound states through here; this page
 * does the DB-backed token check that middleware (Edge, DB-free) cannot.
 *
 * Branches (in order):
 *   1. already a bound member → dashboard
 *   2. invalid / expired / revoked token → error (no LINE button, no form)
 *   3. not logged in → welcome + "LINEで登録" (returns to this same URL)
 *   4. logged in via LINE, unbound → name/grade registration form
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await auth()

  // 1. Already bound → registration is unnecessary.
  if (session?.user?.id) redirect('/')

  // 2. Validate the token before exposing any button/form.
  const invite = await db.query.registrationInvites.findFirst({
    where: eq(registrationInvites.token, token),
    columns: { revokedAt: true, expiresAt: true },
  })
  if (!isRegistrationInviteUsable(invite)) {
    return (
      <Shell>
        <div>
          <h1 className="text-xl font-bold">招待リンクが無効です</h1>
          <p className="mt-2 text-sm text-gray-600">
            この招待リンクは無効か期限切れです。管理者にご連絡ください。
          </p>
        </div>
      </Shell>
    )
  }

  // 3. Not logged in → welcome + LINE login (comes back to this URL).
  const lineUserId = session?.user?.lineUserId
  if (!lineUserId) {
    return (
      <Shell>
        <div>
          <h1 className="text-xl font-bold">かげとら 会員登録</h1>
          <p className="mt-2 text-sm text-gray-600">
            招待リンクから会員登録します。まず LINE アカウントで認証してください。
          </p>
        </div>
        <form
          action={async () => {
            'use server'
            await signIn('line', { redirectTo: `/register/${token}` })
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-[#06c755] px-4 py-3 text-sm font-semibold text-white hover:bg-[#05a648]"
          >
            LINE で登録
          </button>
        </form>
      </Shell>
    )
  }

  // 4. Logged in via LINE but unbound → name/grade form.
  return (
    <Shell>
      <div>
        <h1 className="text-xl font-bold">会員登録</h1>
        <p className="mt-2 text-sm text-gray-600">
          お名前と級を入力して登録を完了してください。級は任意で、後から変更できます。
        </p>
      </div>
      <RegisterForm token={token} />
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-6 shadow-lg">
        {children}
      </div>
    </div>
  )
}
