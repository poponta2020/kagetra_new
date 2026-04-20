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
  verifyLineLinkStateCookie,
  type LineProfile,
} from '@/lib/line-oauth'

export const dynamic = 'force-dynamic'

/**
 * LINE Login OAuth2 callback handler.
 *
 * Flow:
 * 1. Verify the signed `state` cookie (CSRF + initiating userId binding).
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

  // Drop the CSRF state cookie on every path (success, error, mismatch).
  // Must happen before early returns so LINE's error redirect also clears it.
  const cookieStore = await cookies()
  const storedCookie = cookieStore.get(LINE_STATE_COOKIE)?.value
  cookieStore.delete(LINE_STATE_COOKIE)

  if (error) {
    return redirectToLinkPage(req, 'denied')
  }
  const verifiedCookie = storedCookie
    ? verifyLineLinkStateCookie(storedCookie)
    : null
  if (!state || !verifiedCookie || state !== verifiedCookie.state) {
    return redirectToLinkPage(req, 'state_mismatch')
  }
  if (!code) {
    return redirectToLinkPage(req, 'oauth_failed')
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // The session that started the flow must be the same session that returns
  // to the callback. A logout/relogin as a different user in another tab
  // between /start and /callback would otherwise attach LINE to whoever is
  // authenticated at callback time.
  if (session.user.id !== verifiedCookie.userId) {
    return redirectToLinkPage(req, 'state_mismatch')
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
      if (!env) return redirectToLinkPage(req, 'missing_env')
      const accessToken = await exchangeCodeForAccessToken(env, code)
      profile = await fetchLineProfile(accessToken)
    }
  } catch {
    // Intentionally do not log the access_token or profile payload.
    return redirectToLinkPage(req, 'oauth_failed')
  }

  // Conflict: another account already linked with this lineUserId.
  const existing = await db.query.users.findFirst({
    where: eq(users.lineUserId, profile.userId),
    columns: { id: true },
  })
  if (existing && existing.id !== session.user.id) {
    return redirectToLinkPage(req, 'conflict')
  }

  try {
    await db
      .update(users)
      .set({ lineUserId: profile.userId, updatedAt: new Date() })
      .where(eq(users.id, session.user.id))
  } catch (err) {
    // Only the 23505 unique_violation race is a conflict; other DB errors
    // (connectivity, timeouts) are operational failures and deserve a
    // different UX + separate observability category.
    if (isUniqueViolation(err)) {
      return redirectToLinkPage(req, 'conflict')
    }
    return redirectToLinkPage(req, 'oauth_failed')
  }

  // Refresh the JWT so middleware sees the new lineUserId without requiring
  // a full sign-out/sign-in. `unstable_update` re-runs the jwt() callback
  // with the `update` trigger; our callback branches on `session.user.lineUserId`.
  try {
    await unstable_update({ user: { lineUserId: profile.userId } })
  } catch {
    // If the refresh fails, the user would otherwise be trapped: edge
    // middleware still sees lineUserId=null in the stale JWT and bounces to
    // /settings/line-link, where the DB says "linked" but the JWT is never
    // rewritten. `nodeJwtCallback` self-heals the JWT against the DB on the
    // next Node render, so the next request through the settings page (or
    // any Server Component) will write a fresh cookie and unblock the user.
  }

  return NextResponse.redirect(new URL('/', req.url))
}

function redirectToLinkPage(req: NextRequest, errorCode: string): NextResponse {
  // Use the request URL as the origin so the redirect stays on the same host
  // as the caller (works behind reverse proxies without requiring NEXTAUTH_URL).
  return NextResponse.redirect(
    new URL(
      `/settings/line-link?error=${encodeURIComponent(errorCode)}`,
      req.url,
    ),
  )
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  // node-postgres exposes the PG error code on the `code` field.
  // 23505 = unique_violation per PostgreSQL error codes.
  const code = (err as { code?: unknown }).code
  if (code === '23505') return true
  // Drizzle may nest the driver error in `.cause`.
  const cause = (err as { cause?: unknown }).cause
  if (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === '23505'
  ) {
    return true
  }
  return false
}
