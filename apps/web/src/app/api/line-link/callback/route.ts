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
 * LINE account-switch callback handler (secondary flow).
 *
 * Primary LINE login is handled by Auth.js (`/api/auth/callback/line`).
 * This route is reached only from `/settings/line-link` when an already-
 * authenticated user wants to point their account at a different LINE ID.
 *
 * Flow:
 * 1. Verify the signed `state` cookie (CSRF + initiating userId binding).
 * 2. Exchange `code` for an access_token (HTTP POST to LINE).
 * 3. Fetch profile with the token.
 * 4. UPDATE users.lineUserId (UNIQUE; collision -> conflict screen),
 *    record lineLinkedAt + lineLinkedMethod='account_switch'.
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
    return NextResponse.redirect(new URL('/auth/signin', req.url))
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
      .set({
        lineUserId: profile.userId,
        lineLinkedAt: new Date(),
        lineLinkedMethod: 'account_switch',
        updatedAt: new Date(),
      })
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
    await unstable_update({
      user: {
        lineUserId: profile.userId,
        lineLinkedAt: new Date().toISOString(),
        lineLinkedMethod: 'account_switch',
      },
    })
  } catch {
    // If the refresh fails, the stale JWT still carries the old lineUserId,
    // which would make /settings/line-link render with the pre-switch state
    // even though the DB already points at the new LINE id. Middleware
    // itself only gates on `session.user.id` (not lineUserId), so the user
    // isn't locked out — but the linked-account UI would lie. The `if (id)`
    // branch of `nodeJwtCallback` re-reads lineUserId/lineLinkedAt/method
    // from the DB on every Node render, so the next request through any
    // Server Component writes a fresh cookie and the UI becomes accurate.
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
