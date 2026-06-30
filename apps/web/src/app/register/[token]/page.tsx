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
 * Visual: A-flat (脱カード — 和紙 surface, header rule + 余白 + タイポ, no
 * card box / shadow). See docs/features/invite-register-redesign/design-spec.md.
 *
 * Branches (in order):
 *   1. already a bound member → dashboard
 *   2. invalid / expired / revoked token → error (no LINE button, no form)
 *   3. not logged in → welcome + "LINEで登録" (returns to this same URL)
 *   4. logged in via LINE, unbound → profile registration form
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
        <p className="rounded-[4px] border border-accent/40 bg-accent-bg px-4 py-3 text-sm text-accent-fg">
          この招待リンクは無効か期限切れです。お手数ですが管理者にご連絡ください。
        </p>
      </Shell>
    )
  }

  // 3. Not logged in → welcome + LINE login (comes back to this URL).
  const lineUserId = session?.user?.lineUserId
  if (!lineUserId) {
    return (
      <Shell>
        <p className="text-sm leading-relaxed text-ink-2">
          招待リンクから会員登録します。まず LINE アカウントで認証してください。
        </p>
        <form
          action={async () => {
            'use server'
            await signIn('line', { redirectTo: `/register/${token}` })
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[4px] bg-line px-4 py-3 text-sm font-semibold text-white hover:bg-line-hover"
          >
            LINE で認証する
          </button>
        </form>
        <p className="text-xs text-ink-meta">
          認証のあと、お名前と級を入力します。
        </p>
      </Shell>
    )
  }

  // 4. Logged in via LINE but unbound → profile registration form.
  return (
    <Shell>
      <p className="flex items-center gap-1.5 text-xs text-ink-meta">
        <span
          aria-hidden
          className="inline-block rotate-45 border-b-2 border-r-2 border-brand"
          style={{ width: '6px', height: '11px', marginBottom: '2px' }}
        />
        LINE 認証済み
      </p>
      <RegisterForm token={token} />
    </Shell>
  )
}

/**
 * A-flat shell: 和紙 canvas, top-aligned narrow column, serif wordmark + subtitle
 * over a bottom rule. No card box / shadow (design-spec §2, §4).
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-5 pb-16 pt-12">
      <div className="mx-auto w-full max-w-[340px] space-y-6">
        <header className="border-b border-border pb-4">
          <h1 className="font-display text-2xl font-semibold tracking-wide text-ink">
            かげとら
          </h1>
          <p className="mt-1 text-xs text-ink-meta">北大かるた会 大会管理アプリ</p>
        </header>
        {children}
      </div>
    </div>
  )
}
