import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from './auth.config'

/**
 * Edge-safe middleware using JWT sessions.
 *
 * Auth.js v5 with JWT strategy reads the session token from cookies without
 * needing DB access, so this runs in the Edge runtime.
 *
 * Per-user gating decisions read only JWT claims set by the Node-side jwt
 * callback in auth.ts:
 *   - token.id set    → user is fully bound to an invited member; allow through
 *   - token.id unset  → LINE login succeeded but no matching internal user row
 *                        yet; force /self-identify so the user can claim
 *   - no session      → force /auth/signin
 */
const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/auth/signin', '/auth/error']
const SELF_IDENTIFY_PATHS = ['/self-identify']

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export default auth((req) => {
  const { nextUrl } = req
  const session = req.auth
  const pathname = nextUrl.pathname

  // Unauthenticated: only /auth/signin is reachable; /auth/error too for LINE errors.
  if (!session) {
    if (startsWithAny(pathname, PUBLIC_PATHS)) return NextResponse.next()
    const url = nextUrl.clone()
    url.pathname = '/auth/signin'
    return NextResponse.redirect(url)
  }

  // Authenticated but no internal id yet → /self-identify (LINE user ID is set,
  // but the user hasn't claimed an invited member row).
  if (
    !session.user?.id &&
    !startsWithAny(pathname, SELF_IDENTIFY_PATHS) &&
    !startsWithAny(pathname, PUBLIC_PATHS)
  ) {
    const url = nextUrl.clone()
    url.pathname = '/self-identify'
    return NextResponse.redirect(url)
  }

  // Authenticated + bound user visiting /auth/signin → dashboard.
  if (startsWithAny(pathname, PUBLIC_PATHS)) {
    const url = nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}
