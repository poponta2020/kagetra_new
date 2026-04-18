import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth, unstable_update } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import {
  LINE_STATE_COOKIE,
  exchangeCodeForAccessToken,
  fetchLineProfile,
  isLineOAuthTestMode,
  readLineOAuthEnv,
  type LineProfile,
} from '@/lib/line-oauth'

export const dynamic = 'force-dynamic'

/**
 * LINE Login OAuth2 callback handler.
 *
 * Flow:
 * 1. Verify `state` against the cookie we set in the Server Action (CSRF).
 * 2. Exchange `code` for an access_token (HTTP POST to LINE).
 * 3. Fetch profile with the token.
 * 4. Persist `users.lineUserId` (UNIQUE; collision -> error screen).
 * 5. Clear the state cookie. Never persist the access_token.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return redirectToLinkPage('denied')
  }

  // State verification (CSRF). Always drop the cookie regardless of outcome.
  const cookieStore = await cookies()
  const storedState = cookieStore.get(LINE_STATE_COOKIE)?.value
  cookieStore.delete(LINE_STATE_COOKIE)

  if (!state || !storedState || state !== storedState) {
    return redirectToLinkPage('state_mismatch')
  }
  if (!code) {
    return redirectToLinkPage('oauth_failed')
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  let profile: LineProfile
  try {
    if (isLineOAuthTestMode()) {
      // Deterministic fixture for Playwright / Vitest integration.
      profile = {
        userId: `Utest-${session.user.id.slice(0, 8)}`,
        displayName: 'Test User',
      }
    } else {
      const env = readLineOAuthEnv()
      if (!env) return redirectToLinkPage('missing_env')
      const accessToken = await exchangeCodeForAccessToken(env, code)
      profile = await fetchLineProfile(accessToken)
    }
  } catch {
    // Intentionally do not log the access_token or profile payload.
    return redirectToLinkPage('oauth_failed')
  }

  // Conflict: another account already linked with this lineUserId.
  const existing = await db.query.users.findFirst({
    where: eq(users.lineUserId, profile.userId),
    columns: { id: true },
  })
  if (existing && existing.id !== session.user.id) {
    return redirectToLinkPage('conflict')
  }

  try {
    await db
      .update(users)
      .set({ lineUserId: profile.userId, updatedAt: new Date() })
      .where(eq(users.id, session.user.id))
  } catch {
    // Catch unique-violation racing with a concurrent link on the other side.
    return redirectToLinkPage('conflict')
  }

  // Refresh the JWT so middleware sees the new lineUserId without requiring
  // a full sign-out/sign-in. `unstable_update` re-runs the jwt() callback
  // with the `update` trigger; our callback branches on `session.user.lineUserId`.
  try {
    await unstable_update({ user: { lineUserId: profile.userId } })
  } catch {
    // If the refresh fails, middleware will redirect to the link page once
    // more (where the DB-backed "linked" state shows and the user can proceed
    // on their next request).
  }

  return NextResponse.redirect(new URL('/', req.url))
}

function redirectToLinkPage(errorCode: string): NextResponse {
  return NextResponse.redirect(
    // Absolute base is injected by Next at runtime via request URL; we use a
    // relative URL here and let NextResponse.redirect resolve it.
    new URL(
      `/settings/line-link?error=${encodeURIComponent(errorCode)}`,
      process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
    ),
  )
}
