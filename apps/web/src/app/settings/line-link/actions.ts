'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  LINE_STATE_COOKIE,
  LINE_STATE_MAX_AGE,
  buildAuthorizeUrl,
  readLineOAuthEnv,
} from '@/lib/line-oauth'

/**
 * Server Action: initiate LINE Login OAuth2 flow.
 *
 * 1. Require authenticated session (otherwise middleware wouldn't even
 *    serve the page, but we double-check here).
 * 2. Generate a CSRF `state` token, store it in an httpOnly cookie.
 * 3. Redirect to LINE authorize URL.
 */
export async function startLineLink() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const env = readLineOAuthEnv()
  if (!env) {
    throw new Error(
      'LINE Login 環境変数が未設定です (LINE_LOGIN_CHANNEL_ID / SECRET / CALLBACK_URL)',
    )
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set(LINE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: LINE_STATE_MAX_AGE,
    path: '/',
  })

  redirect(buildAuthorizeUrl(env, state))
}
