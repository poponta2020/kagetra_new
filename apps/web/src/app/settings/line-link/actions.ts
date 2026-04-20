'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  LINE_STATE_COOKIE,
  LINE_STATE_MAX_AGE,
  buildAuthorizeUrl,
  buildLineLinkStateCookie,
  readLineOAuthEnv,
} from '@/lib/line-oauth'

/**
 * Server Action: initiate LINE Login OAuth2 flow.
 *
 * 1. Require authenticated session (otherwise middleware wouldn't even
 *    serve the page, but we double-check here).
 * 2. Generate a CSRF `state` token bound to the initiating userId, store
 *    the signed pair in an httpOnly cookie.
 * 3. Redirect to LINE authorize URL (plain state, no userId leaks).
 */
export async function startLineLink() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const env = readLineOAuthEnv()
  if (!env) {
    // The callback route surfaces the same `missing_env` code to the page,
    // which renders an admin-facing message. Keep the two entry points
    // symmetric so users never hit a raw 500 from a config gap.
    redirect('/settings/line-link?error=missing_env')
  }

  const state = crypto.randomUUID()
  const signedCookie = buildLineLinkStateCookie(state, session.user.id)
  const cookieStore = await cookies()
  cookieStore.set(LINE_STATE_COOKIE, signedCookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: LINE_STATE_MAX_AGE,
    path: '/',
  })

  redirect(buildAuthorizeUrl(env, state))
}
